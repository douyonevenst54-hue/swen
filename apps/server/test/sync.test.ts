import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordCabinetEvents, createCabinet } from "../src/lib/cabinets";
import { createSetupCode, enrollDevice, revokeDevice, unlockStaff } from "../src/lib/devices";
import { authenticateSync } from "../src/lib/device-auth";
import { HttpError } from "../src/lib/http";
import { pullChanges, pushChanges, withFacilityLock } from "../src/lib/sync";
import type { Db } from "../src/lib/db";
import { emptyPush, KEK, makeFacility, now, observation, patient, TEST_DB_URL, testDb } from "./helpers";

const suite = TEST_DB_URL ? describe : describe.skip;

suite("device enrollment and unlock", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });
  afterAll(() => db.$disconnect());

  it("enrolls with a one-time code and returns the roster", async () => {
    const { facility } = await makeFacility(db);
    const { code } = await createSetupCode(db, facility.id);
    const res = await enrollDevice(db, KEK, { code: code.toLowerCase().replace("-", " "), deviceName: "Tablet A" });
    expect(res.facility.id).toBe(facility.id);
    expect(res.staff.map((s) => s.name).sort()).toEqual(["Doctor B", "Nurse A"]);
    expect(res.deviceToken.length).toBeGreaterThan(30);
    await expect(enrollDevice(db, KEK, { code, deviceName: "Tablet B" })).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("rejects expired codes", async () => {
    const { facility } = await makeFacility(db);
    const { code } = await createSetupCode(db, facility.id, new Date(Date.now() - 48 * 3600_000));
    await expect(enrollDevice(db, KEK, { code, deviceName: "X" })).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("unlocks with the right PIN, returns the same device key every time, locks out after 5 failures", async () => {
    const { facility, nurse } = await makeFacility(db);
    const { code } = await createSetupCode(db, facility.id);
    const enrolled = await enrollDevice(db, KEK, { code, deviceName: "Tablet" });
    const device = await db.device.findUniqueOrThrow({ where: { id: enrolled.deviceId } });
    const authed = { id: device.id, facilityId: device.facilityId, name: device.name, keyCiphertext: device.keyCiphertext };

    const a = await unlockStaff(db, KEK, authed, { staffId: nurse.id, pin: "123456" }, 7);
    const b = await unlockStaff(db, KEK, authed, { staffId: nurse.id, pin: "123456" }, 7);
    expect(Buffer.from(a.deviceKey, "base64")).toHaveLength(32);
    expect(a.deviceKey).toBe(b.deviceKey);
    expect(a.session.token).not.toBe(b.session.token);
    // Only the newest session per staff+device survives.
    expect(await db.staffSession.count({ where: { staffId: nurse.id, deviceId: device.id } })).toBe(1);

    for (let i = 0; i < 4; i++) await expect(unlockStaff(db, KEK, authed, { staffId: nurse.id, pin: "000000" }, 7)).rejects.toMatchObject({ code: "wrong_pin" });
    await expect(unlockStaff(db, KEK, authed, { staffId: nurse.id, pin: "000000" }, 7)).rejects.toMatchObject({ code: "locked_out" });
    // Even the right PIN is refused while locked out.
    await expect(unlockStaff(db, KEK, authed, { staffId: nurse.id, pin: "123456" }, 7)).rejects.toMatchObject({ code: "locked_out" });
  });

  it("cannot be brute-forced with parallel guesses", async () => {
    const { facility, nurse } = await makeFacility(db);
    const { code } = await createSetupCode(db, facility.id);
    const enrolled = await enrollDevice(db, KEK, { code, deviceName: "Tablet" });
    const device = await db.device.findUniqueOrThrow({ where: { id: enrolled.deviceId } });
    const guesses = Array.from({ length: 20 }, (_, i) => unlockStaff(db, KEK, { ...device }, { staffId: nurse.id, pin: String(100000 + i) }, 7).catch((e) => e.code));
    const codes = await Promise.all(guesses);
    // At most 5 guesses were actually checked; the rest were refused as locked out.
    expect(codes.filter((c) => c === "wrong_pin").length).toBeLessThanOrEqual(5);
    expect(codes).toContain("locked_out");
    await expect(unlockStaff(db, KEK, { ...device }, { staffId: nurse.id, pin: "123456" }, 7)).rejects.toMatchObject({ code: "locked_out" });
  });

  it("authenticates sync with device token + staff session, and revocation kills both", async () => {
    const { facility, nurse } = await makeFacility(db);
    const { code } = await createSetupCode(db, facility.id);
    const enrolled = await enrollDevice(db, KEK, { code, deviceName: "Tablet" });
    const device = await db.device.findUniqueOrThrow({ where: { id: enrolled.deviceId } });
    const unlocked = await unlockStaff(db, KEK, { ...device }, { staffId: nurse.id, pin: "123456" }, 7);
    const req = (session?: string) =>
      new Request("http://x/api/v1/sync/pull", {
        headers: { authorization: `Bearer ${enrolled.deviceToken}`, ...(session ? { "x-staff-session": session } : {}) },
      });

    const ok = await authenticateSync(db, req(unlocked.session.token));
    expect(ok.staffId).toBe(nurse.id);
    await expect(authenticateSync(db, req())).rejects.toMatchObject({ code: "session_expired" });
    await revokeDevice(db, device.id);
    await expect(authenticateSync(db, req(unlocked.session.token))).rejects.toMatchObject({ code: "device_revoked" });
  });
});

suite("push and pull", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });
  afterAll(() => db.$disconnect());

  async function setup() {
    const f = await makeFacility(db);
    const device = await db.device.create({ data: { facilityId: f.facility.id, name: "T", tokenHash: randomUUID(), keyCiphertext: "x" } });
    return { ...f, ctx: { facilityId: f.facility.id, deviceId: device.id } };
  }

  it("stores patients, observations, escalations and movements, recomputing MEWS on the server", async () => {
    const { nurse, ctx } = await setup();
    const p = patient(nurse.id);
    // Device claims score 0, but RR 32 scores 3 → HIGH. The server must not trust the device.
    const o = observation(p.id, nurse.id, { rr: 32, mewsTotal: 0, mewsLevel: "low" });
    const e = { id: randomUUID(), observationId: o.id, patientId: p.id, action: "called_doctor" as const, at: now(), by: nurse.id, note: null };
    const itemId = randomUUID();
    const item = { id: itemId, code: "GLOVE", nameHt: "Gan", nameFr: "Gants", unit: "bwat", category: null, minStock: 2, active: true, updatedAt: now() };
    const m = { id: randomUUID(), itemId, type: "receive" as const, quantity: 10, lot: "A", expiryDate: "2027-12-31", location: null, patientId: null, at: now(), by: nurse.id, note: null };

    const res = await pushChanges(db, ctx, { patients: [p], observations: [o], escalations: [e], items: [item], movements: [m] });
    expect(res.rejected).toEqual([]);
    expect(res.accepted.sort()).toEqual([p.id, o.id, e.id, itemId, m.id].sort());

    const stored = await db.observation.findUniqueOrThrow({ where: { id: o.id } });
    expect(stored.mewsTotal).toBe(3);
    expect(stored.mewsLevel).toBe("high");
    expect(stored.deviceMewsTotal).toBe(0);

    // Pushing the same batch again is harmless (idempotent).
    const again = await pushChanges(db, ctx, { patients: [p], observations: [o], escalations: [e], items: [item], movements: [m] });
    expect(again.rejected).toEqual([]);
    expect(await db.observation.count({ where: { id: o.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { itemId } })).toBe(1);
  });

  it("rejects records whose dependencies are missing (retryable) or whose staff is unknown (not retryable)", async () => {
    const { nurse, ctx } = await setup();
    const orphan = observation(randomUUID(), nurse.id);
    const stranger = patient(randomUUID());
    const res = await pushChanges(db, ctx, { ...emptyPush(), observations: [orphan], patients: [stranger] });
    expect(res.rejected).toEqual(
      expect.arrayContaining([
        { id: orphan.id, reason: "unknown_patient", retryable: true },
        { id: stranger.id, reason: "unknown_staff", retryable: false },
      ]),
    );
  });

  it("cannot write into another facility's records", async () => {
    const a = await setup();
    const b = await setup();
    const p = patient(a.nurse.id);
    await pushChanges(db, a.ctx, { ...emptyPush(), patients: [p] });
    const res = await pushChanges(db, b.ctx, { ...emptyPush(), patients: [{ ...p, updatedBy: b.nurse.id, givenName: "Hacked", updatedAt: new Date(Date.now() + 1000).toISOString() }] });
    expect(res.rejected[0]).toMatchObject({ id: p.id, reason: "other_facility" });
    expect((await db.patient.findUniqueOrThrow({ where: { id: p.id } })).givenName).toBe("Marie");
    // And B's pull never contains A's patient.
    const pull = await pullChanges(db, b.ctx.facilityId, null);
    expect(pull.changes.patients).toEqual([]);
  });

  it("resolves patient edits by last-write-wins", async () => {
    const { nurse, doctor, ctx } = await setup();
    const base = patient(nurse.id);
    await pushChanges(db, ctx, { ...emptyPush(), patients: [base] });
    const t1 = new Date(Date.parse(base.updatedAt) + 60_000).toISOString();
    const t0 = new Date(Date.parse(base.updatedAt) + 30_000).toISOString();
    await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...base, bed: "9", updatedAt: t1, updatedBy: doctor.id }] });
    // An older edit arriving late (device was offline) does not overwrite the newer one, but is still accepted.
    const late = await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...base, bed: "5", updatedAt: t0 }] });
    expect(late.accepted).toEqual([base.id]);
    expect((await db.patient.findUniqueOrThrow({ where: { id: base.id } })).bed).toBe("9");
  });

  it("re-sends the newer copy to a device whose older edit lost", async () => {
    const { nurse, ctx } = await setup();
    const base = patient(nurse.id);
    await pushChanges(db, ctx, { ...emptyPush(), patients: [base] });
    const newer = new Date(Date.parse(base.updatedAt) + 60_000).toISOString();
    await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...base, bed: "9", updatedAt: newer }] });
    const cursor = (await pullChanges(db, ctx.facilityId, null)).cursor;
    // A device past that cursor sends an older edit; the server keeps "9" but moves the row
    // forward so the device pulls it back instead of keeping its own stale copy forever.
    await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...base, bed: "5" }] });
    const next = await pullChanges(db, ctx.facilityId, cursor);
    expect(next.changes.patients.map((p) => p.bed)).toEqual(["9"]);
  });

  it("does not let a device clock in the future win every later edit", async () => {
    const { nurse, ctx } = await setup();
    const base = patient(nurse.id);
    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString();
    await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...base, bed: "future", updatedAt: farFuture }] });
    const stored = await db.patient.findUniqueOrThrow({ where: { id: base.id } });
    expect(stored.updatedAt.getTime()).toBeLessThan(Date.now() + 10 * 60_000);
    // An honest edit made 10 minutes later wins.
    await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...base, bed: "honest", updatedAt: new Date(Date.now() + 10 * 60_000).toISOString() }] });
    expect((await db.patient.findUniqueOrThrow({ where: { id: base.id } })).bed).toBe("honest");
  });

  it("pages pulls by cursor without skipping or repeating rows", async () => {
    const { nurse, ctx } = await setup();
    const patients = Array.from({ length: 7 }, () => patient(nurse.id));
    await pushChanges(db, ctx, { ...emptyPush(), patients });
    const obs = patients.flatMap((p) => [observation(p.id, nurse.id), observation(p.id, nurse.id)]);
    await pushChanges(db, ctx, { ...emptyPush(), observations: obs });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const page = await pullChanges(db, ctx.facilityId, cursor, 4);
      seen.push(...page.changes.patients.map((p) => p.id), ...page.changes.observations.map((o) => o.id));
      cursor = page.cursor;
      pages++;
      if (!page.hasMore) break;
    }
    expect(pages).toBe(6); // 21 rows / 4 per page
    expect(new Set(seen).size).toBe(21);
    expect(seen).toHaveLength(21);
    // Nothing new → empty page, same cursor.
    const empty = await pullChanges(db, ctx.facilityId, cursor);
    expect(empty.changes.observations).toEqual([]);
    expect(empty.cursor).toBe(cursor);
    // An edit moves the row to the end of the stream so other devices receive it.
    await pushChanges(db, ctx, { ...emptyPush(), patients: [{ ...patients[0]!, bed: "12", updatedAt: new Date(Date.now() + 5000).toISOString() }] });
    const next = await pullChanges(db, ctx.facilityId, cursor);
    expect(next.changes.patients.map((p) => p.bed)).toEqual(["12"]);
  });

  it("never lets a pull skip a row from a slow concurrent write", async () => {
    const { nurse, ctx } = await setup();
    const p = patient(nurse.id);
    await pushChanges(db, ctx, { ...emptyPush(), patients: [p] });
    const first = await pullChanges(db, ctx.facilityId, null);

    // A slow writer holds the facility lock with an uncommitted row...
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowObs = observation(p.id, nurse.id);
    const slow = withFacilityLock(db, ctx.facilityId, async (tx) => {
      await tx.observation.create({
        data: { ...slowObs, facilityId: ctx.facilityId, recordedAt: new Date(slowObs.recordedAt), mewsTotal: 0, mewsLevel: "low", mewsComplete: true },
      });
      await gate;
    });
    await new Promise((r) => setTimeout(r, 100));
    // ...a fast writer must wait for it (same facility lock)...
    const fastObs = observation(p.id, nurse.id);
    const fast = pushChanges(db, ctx, { ...emptyPush(), observations: [fastObs] });
    await new Promise((r) => setTimeout(r, 100));
    // ...so a pull right now sees neither, and its cursor stays put.
    const mid = await pullChanges(db, ctx.facilityId, first.cursor);
    expect(mid.changes.observations).toEqual([]);
    release();
    await slow;
    await fast;
    const after = await pullChanges(db, ctx.facilityId, mid.cursor);
    expect(after.changes.observations.map((o) => o.id).sort()).toEqual([slowObs.id, fastObs.id].sort());
  });

  it("includes the facility's MEWS rules in every pull", async () => {
    const { facility, ctx } = await setup();
    await db.facility.update({ where: { id: facility.id }, data: { mewsConfig: { custom: true } } });
    const res = await pullChanges(db, ctx.facilityId, null);
    expect(res.facility.mewsConfig).toEqual({ custom: true });
    expect(res.staff.length).toBe(2);
  });
});

suite("cabinet door sensor", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });
  afterAll(() => db.$disconnect());

  it("records buffered events in order and tracks door state", async () => {
    const { facility } = await makeFacility(db);
    const { id, token } = await createCabinet(db, facility.id, "Pharmacy cabinet", "Sal A");
    const res = await recordCabinetEvents(db, token, {
      events: [
        { type: "door_close", agoMs: 1_000 },
        { type: "door_open", agoMs: 60_000 },
        { type: "heartbeat", agoMs: 0 },
      ],
    });
    expect(res).toEqual({ stored: 2, doorOpen: false });
    const events = await db.cabinetEvent.findMany({ where: { cabinetId: id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["door_open", "door_close"]);
    await expect(recordCabinetEvents(db, "wrong", { events: [{ type: "heartbeat", agoMs: 0 }] })).rejects.toBeInstanceOf(HttpError);
  });
});
