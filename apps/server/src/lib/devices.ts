/** Device enrollment and staff unlock. Testable without HTTP. */
import type { EnrollResponse, UnlockResponse } from "@swen/core";
import type { Db } from "./db";
import { hashToken, newDataKey, newSetupCode, newToken, normalizeSetupCode, openKey, sealKey, verifyPin } from "./crypto";
import { HttpError } from "./http";
import { listStaff, toStaff } from "./sync";
import type { AuthedDevice } from "./device-auth";

export const SETUP_CODE_HOURS = 24;
export const MAX_PIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export async function createSetupCode(db: Db, facilityId: string, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const code = newSetupCode();
  const expiresAt = new Date(now.getTime() + SETUP_CODE_HOURS * 3600_000);
  await db.enrollmentCode.create({ data: { facilityId, codeHash: hashToken(code), expiresAt } });
  return { code, expiresAt };
}

export async function enrollDevice(
  db: Db,
  kek: Buffer,
  input: { code: string; deviceName: string; appVersion?: string | null },
  now = new Date(),
): Promise<EnrollResponse> {
  const codeHash = hashToken(normalizeSetupCode(input.code));
  const deviceToken = newToken();
  const result = await db.$transaction(async (tx) => {
    // Claim the code atomically so it can be used exactly once.
    const claimed = await tx.enrollmentCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new HttpError(400, "invalid_code");
    const code = await tx.enrollmentCode.findUniqueOrThrow({ where: { codeHash }, select: { id: true, facilityId: true, facility: { select: { id: true, name: true } } } });
    const device = await tx.device.create({
      data: {
        facilityId: code.facilityId,
        name: input.deviceName.trim().slice(0, 80) || "Device",
        appVersion: input.appVersion ?? null,
        tokenHash: hashToken(deviceToken),
        keyCiphertext: sealKey(newDataKey(), kek),
        lastSeenAt: now,
      },
      select: { id: true },
    });
    await tx.enrollmentCode.update({ where: { id: code.id }, data: { deviceId: device.id } });
    return { deviceId: device.id, facility: code.facility };
  });
  const staff = await listStaff(db, result.facility.id);
  return { deviceId: result.deviceId, deviceToken, facility: result.facility, staff: staff.filter((s) => s.active), serverTime: now.toISOString() };
}

export async function unlockStaff(
  db: Db,
  kek: Buffer,
  device: AuthedDevice,
  input: { staffId: string; pin: string },
  sessionDays: number,
  now = new Date(),
): Promise<UnlockResponse> {
  const staff = await db.staff.findFirst({
    where: { id: input.staffId, facilityId: device.facilityId },
    select: { id: true, name: true, role: true, active: true, pinHash: true, pinSetAt: true, lockedUntil: true },
  });
  if (!staff) throw new HttpError(401, "wrong_pin");
  if (!staff.active) throw new HttpError(403, "staff_inactive");
  const lockUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
  const lockedOut = (until: Date) => new HttpError(429, "locked_out", { retryAt: until.toISOString() });
  if (staff.lockedUntil && staff.lockedUntil > now) throw lockedOut(staff.lockedUntil);

  // Claim an attempt BEFORE checking the PIN, atomically. Parallel guesses each
  // take a slot, so no more than MAX_PIN_ATTEMPTS can ever be checked per window.
  const claimed = await db.staff.updateMany({
    where: { id: staff.id, failedAttempts: { lt: MAX_PIN_ATTEMPTS }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { failedAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    await db.staff.updateMany({ where: { id: staff.id, failedAttempts: { gte: MAX_PIN_ATTEMPTS } }, data: { failedAttempts: 0, lockedUntil: lockUntil } });
    throw lockedOut(lockUntil);
  }

  const ok = await verifyPin(input.pin, staff.pinHash);
  if (!ok) {
    const locked = await db.staff.updateMany({ where: { id: staff.id, failedAttempts: { gte: MAX_PIN_ATTEMPTS } }, data: { failedAttempts: 0, lockedUntil: lockUntil } });
    if (locked.count) throw lockedOut(lockUntil);
    throw new HttpError(401, "wrong_pin");
  }

  const token = newToken();
  const expiresAt = new Date(now.getTime() + sessionDays * 86_400_000);
  await db.$transaction([
    db.staff.update({ where: { id: staff.id }, data: { failedAttempts: 0, lockedUntil: null } }),
    db.staffSession.deleteMany({ where: { staffId: staff.id, deviceId: device.id } }),
    db.staffSession.create({ data: { staffId: staff.id, deviceId: device.id, tokenHash: hashToken(token), expiresAt } }),
  ]);

  return {
    staff: toStaff(staff),
    deviceKey: openKey(device.keyCiphertext, kek).toString("base64"),
    session: { token, expiresAt: expiresAt.toISOString() },
    serverTime: now.toISOString(),
  };
}

export async function revokeDevice(db: Db, deviceId: string, now = new Date()): Promise<void> {
  await db.$transaction([
    db.device.update({ where: { id: deviceId }, data: { revokedAt: now } }),
    db.staffSession.deleteMany({ where: { deviceId } }),
  ]);
}
