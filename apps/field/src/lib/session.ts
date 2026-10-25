/** Device enrollment and staff unlock (online first time, offline after). */
import { clockOffsetMs, type Staff } from "@swen/core";
import { api, ApiError } from "./api";
import { fromB64, importDataKey, open, seal, unwrapDataKey, wrapDataKey } from "./crypto";
import { getMeta, localDb, setMeta, type DeviceRegistration, type SwenDb } from "./db";

export const APP_VERSION = "0.1.0";
export const LOCAL_MAX_FAILURES = 5;
export const LOCAL_LOCKOUT_MS = 15 * 60_000;
/** Offline unlock stops working this long after the last online unlock. */
export const OFFLINE_UNLOCK_MAX_AGE_MS = 30 * 86_400_000;

/** A locally wrapped key is usable only if it is recent and newer than the current PIN. */
export function wrappedKeyStillValid(w: { wrappedAt?: string }, staff: { pinSetAt?: string }, now = Date.now()): boolean {
  if (!w.wrappedAt) return false;
  const at = Date.parse(w.wrappedAt);
  if (now - at > OFFLINE_UNLOCK_MAX_AGE_MS) return false;
  if (staff.pinSetAt && Date.parse(staff.pinSetAt) > at) return false;
  return true;
}

/** Drop offline keys for staff who are inactive or whose PIN changed. */
export async function pruneWrappedKeys(db: SwenDb, roster: Staff[]): Promise<void> {
  const wrappedKeys = (await getMeta("wrappedKeys", db)) ?? {};
  let changed = false;
  for (const [staffId, w] of Object.entries(wrappedKeys)) {
    const s = roster.find((x) => x.id === staffId);
    if (!s || !s.active || (s.pinSetAt && w.wrappedAt && Date.parse(s.pinSetAt) > Date.parse(w.wrappedAt))) {
      delete wrappedKeys[staffId];
      changed = true;
    }
  }
  if (changed) await setMeta("wrappedKeys", wrappedKeys, db);
}

/** Everything that exists only while a staff member is logged in. */
export interface Session {
  staff: Staff;
  key: CryptoKey;
  device: DeviceRegistration;
  /** Sync session; absent or expired when the unlock happened offline long ago. */
  syncToken: string | null;
  syncTokenExpiresAt: string | null;
}

export class UnlockError extends Error {
  constructor(
    public code: "wrong_pin" | "locked_out" | "first_time_online" | "staff_inactive" | "device_revoked" | "not_enrolled",
    public retryAt?: number,
  ) {
    super(code);
  }
}

export async function enroll(serverUrl: string, code: string, deviceName: string, db: SwenDb = localDb()): Promise<DeviceRegistration> {
  const { data, sentAt, receivedAt } = await api.enroll(serverUrl, { code, deviceName, appVersion: APP_VERSION });
  const device: DeviceRegistration = {
    serverUrl,
    deviceId: data.deviceId,
    deviceToken: data.deviceToken,
    deviceName,
    facility: data.facility,
    enrolledAt: new Date().toISOString(),
  };
  await db.transaction("rw", db.meta, async () => {
    await setMeta("device", device, db);
    await setMeta("roster", data.staff, db);
    await setMeta("clockOffsetMs", clockOffsetMs(data.serverTime, sentAt, receivedAt), db);
    await setMeta("revoked", false, db);
  });
  // Ask the browser not to evict our data when storage is low.
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      /* not critical */
    }
  }
  return device;
}

export async function refreshRoster(db: SwenDb = localDb()): Promise<Staff[] | null> {
  const device = await getMeta("device", db);
  if (!device) return null;
  try {
    const { data } = await api.roster({ serverUrl: device.serverUrl, deviceToken: device.deviceToken });
    await setMeta("roster", data.staff, db);
    await pruneWrappedKeys(db, data.staff);
    return data.staff;
  } catch (e) {
    if (e instanceof ApiError && e.code === "device_revoked") await setMeta("revoked", true, db);
    return null;
  }
}

async function bumpFailure(db: SwenDb, staffId: string): Promise<never> {
  const lockouts = (await getMeta("lockouts", db)) ?? {};
  const cur = lockouts[staffId] ?? { failures: 0, lockedUntil: null };
  const failures = cur.failures + 1;
  if (failures >= LOCAL_MAX_FAILURES) {
    const until = Date.now() + LOCAL_LOCKOUT_MS;
    lockouts[staffId] = { failures: 0, lockedUntil: until };
    await setMeta("lockouts", lockouts, db);
    throw new UnlockError("locked_out", until);
  }
  lockouts[staffId] = { failures, lockedUntil: null };
  await setMeta("lockouts", lockouts, db);
  throw new UnlockError("wrong_pin");
}

async function clearFailures(db: SwenDb, staffId: string) {
  const lockouts = (await getMeta("lockouts", db)) ?? {};
  if (lockouts[staffId]) {
    delete lockouts[staffId];
    await setMeta("lockouts", lockouts, db);
  }
}

/**
 * Unlock for one staff member. Tries the server first (fresh sync session,
 * catches PIN changes and deactivation); falls back to the locally wrapped
 * key when the server cannot be reached.
 */
export async function unlock(staffId: string, pin: string, db: SwenDb = localDb()): Promise<Session> {
  const device = await getMeta("device", db);
  if (!device) throw new UnlockError("not_enrolled");
  const roster = (await getMeta("roster", db)) ?? [];
  const staff = roster.find((s) => s.id === staffId);
  if (!staff) throw new UnlockError("wrong_pin");
  if (!staff.active) throw new UnlockError("staff_inactive");

  const lock = (await getMeta("lockouts", db))?.[staffId];
  if (lock?.lockedUntil && lock.lockedUntil > Date.now()) throw new UnlockError("locked_out", lock.lockedUntil);

  // 1) Online unlock.
  try {
    const { data, sentAt, receivedAt } = await api.unlock({ serverUrl: device.serverUrl, deviceToken: device.deviceToken }, { staffId, pin });
    const raw = fromB64(data.deviceKey);
    const key = await importDataKey(raw);
    const wrapped = await wrapDataKey(raw, pin);
    wrapped.wrappedAt = data.serverTime; // server clock, comparable with pinSetAt
    raw.fill(0);
    const sealedToken = await seal(key, data.session.token);
    await db.transaction("rw", db.meta, async () => {
      const wrappedKeys = (await getMeta("wrappedKeys", db)) ?? {};
      wrappedKeys[staffId] = wrapped;
      await setMeta("wrappedKeys", wrappedKeys, db);
      const sessions = (await getMeta("sessions", db)) ?? {};
      sessions[staffId] = { sealed: sealedToken, expiresAt: data.session.expiresAt };
      await setMeta("sessions", sessions, db);
      await setMeta("clockOffsetMs", clockOffsetMs(data.serverTime, sentAt, receivedAt), db);
    });
    await clearFailures(db, staffId);
    return { staff: data.staff, key, device, syncToken: data.session.token, syncTokenExpiresAt: data.session.expiresAt };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.code === "wrong_pin") {
      // The server is the authority on the PIN (it may have been reset). Count it locally too.
      return bumpFailure(db, staffId);
    }
    if (e.code === "locked_out") throw new UnlockError("locked_out", e.retryAt ? Date.parse(e.retryAt) : Date.now() + LOCAL_LOCKOUT_MS);
    if (e.code === "staff_inactive") {
      await forgetStaff(db, staffId);
      throw new UnlockError("staff_inactive");
    }
    if (e.code === "device_revoked") {
      await setMeta("revoked", true, db);
      throw new UnlockError("device_revoked");
    }
    if (!e.offline && e.status < 500) throw e;
    // Offline or server error: fall through to the local unlock.
  }

  // 2) Offline unlock.
  const wrapped = (await getMeta("wrappedKeys", db))?.[staffId];
  if (!wrapped || !wrappedKeyStillValid(wrapped, staff)) throw new UnlockError("first_time_online");
  const key = await unwrapDataKey(wrapped, pin);
  if (!key) return bumpFailure(db, staffId);
  await clearFailures(db, staffId);

  const stored = (await getMeta("sessions", db))?.[staffId];
  let syncToken: string | null = null;
  if (stored && Date.parse(stored.expiresAt) > Date.now()) {
    try {
      syncToken = await open<string>(key, stored.sealed);
    } catch {
      syncToken = null;
    }
  }
  return { staff, key, device, syncToken, syncTokenExpiresAt: syncToken ? stored!.expiresAt : null };
}

/** Remove a staff member's local key and session (deactivated on the server). */
export async function forgetStaff(db: SwenDb, staffId: string): Promise<void> {
  await db.transaction("rw", db.meta, async () => {
    const wrappedKeys = (await getMeta("wrappedKeys", db)) ?? {};
    delete wrappedKeys[staffId];
    await setMeta("wrappedKeys", wrappedKeys, db);
    const sessions = (await getMeta("sessions", db)) ?? {};
    delete sessions[staffId];
    await setMeta("sessions", sessions, db);
  });
}

/** Wipe everything on this device (after confirmation in Settings). */
export async function resetDevice(db: SwenDb = localDb()): Promise<void> {
  await db.delete();
}
