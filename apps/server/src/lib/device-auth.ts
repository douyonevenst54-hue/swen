/** Authentication for the device API: device token + (for sync) staff session. */
import type { Db } from "./db";
import { hashToken } from "./crypto";
import { bearer, HttpError } from "./http";

export interface AuthedDevice {
  id: string;
  facilityId: string;
  name: string;
  keyCiphertext: string;
}

export async function authenticateDevice(db: Db, req: Request, touch = true): Promise<AuthedDevice> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthorized");
  const device = await db.device.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, facilityId: true, name: true, keyCiphertext: true, revokedAt: true, lastSeenAt: true },
  });
  if (!device) throw new HttpError(401, "unauthorized");
  if (device.revokedAt) throw new HttpError(401, "device_revoked");
  // Avoid a write on every request: update at most once a minute.
  if (touch && (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000)) {
    await db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }
  return { id: device.id, facilityId: device.facilityId, name: device.name, keyCiphertext: device.keyCiphertext };
}

export async function authenticateSync(db: Db, req: Request): Promise<{ device: AuthedDevice; staffId: string }> {
  const device = await authenticateDevice(db, req);
  const token = req.headers.get("x-staff-session");
  if (!token) throw new HttpError(401, "session_expired");
  const session = await db.staffSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { deviceId: true, expiresAt: true, staff: { select: { id: true, active: true, facilityId: true } } },
  });
  if (!session || session.deviceId !== device.id || session.expiresAt < new Date()) throw new HttpError(401, "session_expired");
  if (!session.staff.active || session.staff.facilityId !== device.facilityId) throw new HttpError(403, "staff_inactive");
  return { device, staffId: session.staff.id };
}
