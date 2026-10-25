/**
 * End-to-end: two simulated tablets (separate IndexedDB databases) talk to a
 * real running Swen server. Enable with:
 *
 *   SWEN_E2E_SERVER=http://localhost:3000 \
 *   SWEN_E2E_CODES="CODE-ONE,CODE-TWO" \     # two fresh setup codes (npm run setup-code)
 *   SWEN_E2E_PIN=111111 \                      # PIN of a nurse in that facility
 *   npm test --workspace @swen/field
 */
import "fake-indexeddb/auto";
import { computeStock } from "@swen/core";
import { describe, expect, it } from "vitest";
import { getMeta, setMeta, SwenDb } from "../src/lib/db";
import * as repo from "../src/lib/repo";
import { enroll, unlock, UnlockError, type Session } from "../src/lib/session";
import { syncOnce } from "../src/lib/sync";

const SERVER = process.env.SWEN_E2E_SERVER;
const CODES = (process.env.SWEN_E2E_CODES ?? "").split(",").filter(Boolean);
const PIN = process.env.SWEN_E2E_PIN ?? "111111";
const suite = SERVER && CODES.length >= 2 ? describe : describe.skip;

async function device(name: string, code: string) {
  const db = new SwenDb(`e2e-${name}-${Math.random()}`);
  await enroll(SERVER!, code, name, db);
  const roster = (await getMeta("roster", db))!;
  const nurse = roster.find((s) => s.role === "nurse")!;
  return { db, nurse };
}

suite("two tablets through a real server", () => {
  it("syncs patients, vitals, escalations and stock both ways, and works offline", async () => {
    // ---- Tablet A: first unlock must be online ----------------------------------
    const A = await device("A", CODES[0]!);
    const sA: Session = await unlock(A.nurse.id, PIN, A.db);
    expect(sA.syncToken).toBeTruthy();

    // First sync pulls the item catalog.
    const first = await syncOnce(sA, A.db);
    expect(first.status).toBe("ok");
    const items = await repo.listItems(A.db);
    expect(items.length).toBeGreaterThan(0);
    const gloves = items[0]!;
    const startStock = computeStock(await repo.allMovements(A.db)).get(gloves.id)?.total ?? 0;

    // Record a patient with dangerous vitals, an escalation and a dispense — all offline-style (local first).
    const p = await repo.savePatient(sA, { ward: "Sal E2E", bed: "1", givenName: "Wilner", familyName: "Desir", sex: "M", birthYear: 1975 }, A.db);
    const { observation, mews } = await repo.addObservation(sA, p, { rr: 31, hr: 128, sbp: 88, tempC: 39.1, spo2: 87, avpu: "V" }, {}, A.db);
    expect(mews.level).toBe("high");
    await repo.addEscalation(sA, observation, "called_doctor", "Dr notified by phone", A.db);
    await repo.addMovements(sA, [{ itemId: gloves.id, type: "dispense", quantity: 2, patientId: p.id }], A.db);
    expect(await repo.pendingCount(A.db)).toBe(4);

    // Patient names are not stored in plain text.
    const raw = await A.db.patients.get(p.id);
    expect(JSON.stringify(raw)).not.toContain("Wilner");

    const pushA = await syncOnce(sA, A.db);
    expect(pushA).toMatchObject({ status: "ok", rejected: 0, waiting: 0 });
    expect(await repo.pendingCount(A.db)).toBe(0);

    // ---- Tablet B: a different device, same facility -------------------------------
    const B = await device("B", CODES[1]!);
    // Without internet the very first unlock is impossible.
    const realUrl = (await getMeta("device", B.db))!.serverUrl;
    await setMeta("device", { ...(await getMeta("device", B.db))!, serverUrl: "http://127.0.0.1:9" }, B.db);
    await expect(unlock(B.nurse.id, PIN, B.db)).rejects.toMatchObject({ code: "first_time_online" });
    await setMeta("device", { ...(await getMeta("device", B.db))!, serverUrl: realUrl }, B.db);

    const sB = await unlock(B.nurse.id, PIN, B.db);
    expect((await syncOnce(sB, B.db)).status).toBe("ok");
    const pB = await repo.getPatient(sB, p.id, B.db);
    expect(pB).toMatchObject({ givenName: "Wilner", familyName: "Desir", ward: "Sal E2E" });
    const obsB = await repo.observationsFor(p.id, B.db);
    expect(obsB).toHaveLength(1);
    expect(obsB[0]).toMatchObject({ mewsLevel: "high" });
    expect((await repo.escalationsFor(p.id, B.db))[0]).toMatchObject({ action: "called_doctor" });

    // ---- Offline unlock on B now works, and a wrong PIN is refused -------------------
    await setMeta("device", { ...(await getMeta("device", B.db))!, serverUrl: "http://127.0.0.1:9" }, B.db);
    await expect(unlock(B.nurse.id, "000000", B.db)).rejects.toBeInstanceOf(UnlockError);
    const offline = await unlock(B.nurse.id, PIN, B.db);
    expect(offline.syncToken).toBeTruthy(); // still-valid session restored from encrypted storage
    expect((await syncOnce(offline, B.db)).status).toBe("offline");

    // Both tablets dispense gloves while B is offline; both edit the bed number.
    await repo.addMovements(offline, [{ itemId: gloves.id, type: "dispense", quantity: 3 }], B.db);
    await repo.savePatient(offline, { ...pB!, bed: "B-edit" }, B.db);
    await new Promise((r) => setTimeout(r, 400));
    await repo.addMovements(sA, [{ itemId: gloves.id, type: "dispense", quantity: 1 }], A.db);
    await repo.savePatient(sA, { ...(await repo.getPatient(sA, p.id, A.db))!, bed: "A-edit-later" }, A.db);

    // B comes back online.
    await setMeta("device", { ...(await getMeta("device", B.db))!, serverUrl: realUrl }, B.db);
    expect((await syncOnce(offline, B.db)).status).toBe("ok");
    expect((await syncOnce(sA, A.db)).status).toBe("ok");
    expect((await syncOnce(offline, B.db)).status).toBe("ok");

    // Last write wins on the patient record, on both devices.
    expect((await repo.getPatient(sA, p.id, A.db))!.bed).toBe("A-edit-later");
    expect((await repo.getPatient(offline, p.id, B.db))!.bed).toBe("A-edit-later");

    // Every dispense counts, and both devices agree on the stock.
    const stockA = computeStock(await repo.allMovements(A.db)).get(gloves.id)!.total;
    const stockB = computeStock(await repo.allMovements(B.db)).get(gloves.id)!.total;
    expect(stockA).toBe(stockB);
    expect(stockA).toBe(startStock - 2 - 3 - 1);
  });
});
