/**
 * Sync engine: push local changes, then pull everything new since the last
 * cursor. Safe to run at any time and to interrupt; every step is idempotent.
 */
import { clockOffsetMs, incomingWins, PUSH_BATCH_LIMIT, type Patient, type PullResponse, type PushRequest } from "@swen/core";
import { api, ApiError, type ApiAuth } from "./api";
import { getMeta, localDb, setMeta, type Dirty, type PatientRow, type RejectedRow, type SwenDb } from "./db";
import { openPatient, sealPatient } from "./repo";
import { forgetStaff, pruneWrappedKeys, type Session } from "./session";

export type SyncOutcome =
  | { status: "ok"; pushed: number; pulled: number; rejected: number; waiting: number; at: string }
  | { status: "offline" }
  | { status: "session_expired" }
  | { status: "device_revoked" }
  | { status: "staff_inactive" }
  | { status: "error"; message: string };

// Order matters: a visit needs its patient, and vitals may point at a visit.
const TABLES = ["patients", "items", "visits", "observations", "escalations", "movements"] as const;
type Table = (typeof TABLES)[number];

let running: Promise<SyncOutcome> | null = null;

/** Only one sync at a time; concurrent callers share the running one. */
export function sync(session: Session, db: SwenDb = localDb()): Promise<SyncOutcome> {
  if (!running) running = syncOnce(session, db).finally(() => (running = null));
  return running;
}

export async function syncOnce(session: Session, db: SwenDb = localDb()): Promise<SyncOutcome> {
  if (await getMeta("revoked", db)) return { status: "device_revoked" };
  if (!session.syncToken || !session.syncTokenExpiresAt || Date.parse(session.syncTokenExpiresAt) < Date.now()) return { status: "session_expired" };
  // Read the registration fresh: the server address may have been changed in Settings.
  const device = (await getMeta("device", db)) ?? session.device;
  const auth: ApiAuth = { serverUrl: device.serverUrl, deviceToken: device.deviceToken, sessionToken: session.syncToken };

  try {
    const pushed = await pushAll(auth, session.key, db);
    const pulled = await pullAll(auth, session, db);
    const at = new Date().toISOString();
    await setMeta("lastSyncAt", at, db);
    const roster = (await getMeta("roster", db)) ?? [];
    await pruneWrappedKeys(db, roster);
    if (roster.find((s) => s.id === session.staff.id)?.active === false) {
      await forgetStaff(db, session.staff.id);
      return { status: "staff_inactive" };
    }
    return { status: "ok", pushed: pushed.accepted, pulled, rejected: pushed.rejected, waiting: pushed.waiting, at };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.offline) return { status: "offline" };
      if (e.code === "session_expired") return { status: "session_expired" };
      if (e.code === "device_revoked") {
        await setMeta("revoked", true, db);
        return { status: "device_revoked" };
      }
      if (e.code === "staff_inactive") {
        await forgetStaff(db, session.staff.id);
        return { status: "staff_inactive" };
      }
      return { status: "error", message: `${e.status} ${e.code}` };
    }
    return { status: "error", message: (e as Error).message };
  }
}

// ---- Push ---------------------------------------------------------------------------

async function pushAll(auth: ApiAuth, key: CryptoKey, db: SwenDb): Promise<{ accepted: number; rejected: number; waiting: number }> {
  let accepted = 0;
  let rejected = 0;
  // Records the server asked us to retry later (a dependency is missing) are skipped for the rest of this run.
  const retryLater = new Set<string>();

  for (let round = 0; round < 100; round++) {
    const batch: Record<Table, { id: string }[]> = { patients: [], items: [], visits: [], observations: [], escalations: [], movements: [] };
    let total = 0;
    for (const table of TABLES) {
      const rows = (await db[table].where("dirty").equals(1).limit(PUSH_BATCH_LIMIT + retryLater.size).toArray()) as unknown as { id: string }[];
      batch[table] = rows.filter((r) => !retryLater.has(r.id)).slice(0, PUSH_BATCH_LIMIT);
      total += batch[table].length;
    }
    if (total === 0) break;

    const body: PushRequest = {
      // Patients are stored encrypted, so they are sent from a decrypted copy.
      patients: await decryptForPush(key, batch.patients as PatientRow[]),
      items: batch.items.map(strip) as PushRequest["items"],
      visits: batch.visits.map(strip) as PushRequest["visits"],
      observations: batch.observations.map(strip) as PushRequest["observations"],
      escalations: batch.escalations.map(strip) as PushRequest["escalations"],
      movements: batch.movements.map(strip) as PushRequest["movements"],
    };

    const { data } = await api.push(auth, body);
    const acceptedSet = new Set(data.accepted);
    const rejectedRows: RejectedRow[] = [];

    await db.transaction("rw", [...TABLES.map((t) => db[t]), db.rejected], async () => {
      for (const table of TABLES) {
        for (const sent of batch[table] as { id: string; updatedAt?: string }[]) {
          if (acceptedSet.has(sent.id)) {
            // Only clear the flag if the row was not edited again while we were sending it.
            const current = (await db[table].get(sent.id)) as { updatedAt?: string; dirty: Dirty } | undefined;
            if (current && current.dirty === 1 && current.updatedAt === sent.updatedAt) {
              await db[table].update(sent.id, { dirty: 0 } as never);
            }
          }
        }
      }
      for (const r of data.rejected) {
        if (r.retryable) {
          retryLater.add(r.id);
          continue;
        }
        const table = TABLES.find((t) => (batch[t] as { id: string }[]).some((x) => x.id === r.id));
        if (!table) continue;
        await db[table].update(r.id, { dirty: 2 } as never);
        rejectedRows.push({ id: r.id, table, reason: r.reason, at: new Date().toISOString() });
      }
      if (rejectedRows.length) await db.rejected.bulkPut(rejectedRows);
    });
    accepted += data.accepted.length;
    rejected += rejectedRows.length;
  }
  return { accepted, rejected, waiting: retryLater.size };
}

function strip<T extends object>(row: T): Omit<T, "dirty"> {
  const { dirty: _d, ...rest } = row as T & { dirty?: unknown };
  void _d;
  return rest as Omit<T, "dirty">;
}

async function decryptForPush(key: CryptoKey, rows: PatientRow[]): Promise<Patient[]> {
  return Promise.all(rows.map(async (row) => strip(await openPatient(key, row))));
}

// ---- Pull ---------------------------------------------------------------------------

async function pullAll(auth: ApiAuth, session: Session, db: SwenDb): Promise<number> {
  let pulled = 0;
  for (let page = 0; page < 200; page++) {
    const cursor = await getMeta("pullCursor", db);
    const { data, sentAt, receivedAt } = await api.pull(auth, cursor);
    await applyPull(session.key, data, db);
    await setMeta("clockOffsetMs", clockOffsetMs(data.serverTime, sentAt, receivedAt), db);
    const c = data.changes;
    pulled += c.patients.length + (c.visits?.length ?? 0) + c.observations.length + c.escalations.length + c.items.length + c.movements.length + (c.equipment?.length ?? 0);
    if (!data.hasMore) break;
  }
  return pulled;
}

export async function applyPull(key: CryptoKey, data: PullResponse, db: SwenDb): Promise<void> {
  const c = data.changes;
  // Encrypt outside the transaction: IndexedDB transactions close on non-IDB awaits.
  const sealedPatients = await Promise.all(c.patients.map((p) => sealPatient(key, p, 0)));

  await db.transaction("rw", [db.meta, db.patients, db.items, db.visits, db.observations, db.escalations, db.movements, db.equipment], async () => {
    // Last-write-wins tables: keep a local unsynced edit only if it is newer.
    const localPatients = await db.patients.bulkGet(sealedPatients.map((p) => p.id));
    const patientsToPut = sealedPatients.filter((incoming, i) => {
      const local = localPatients[i];
      return !(local && local.dirty === 1 && incomingWins(incoming.updatedAt, local.updatedAt));
    });
    await db.patients.bulkPut(patientsToPut);

    const localItems = await db.items.bulkGet(c.items.map((i) => i.id));
    await db.items.bulkPut(
      c.items.filter((incoming, i) => !(localItems[i] && localItems[i]!.dirty === 1 && incomingWins(incoming.updatedAt, localItems[i]!.updatedAt))).map((i) => ({ ...i, dirty: 0 as const })),
    );

    const visits = c.visits ?? [];
    const localVisits = await db.visits.bulkGet(visits.map((v) => v.id));
    await db.visits.bulkPut(
      visits.filter((incoming, i) => !(localVisits[i] && localVisits[i]!.dirty === 1 && incomingWins(incoming.updatedAt, localVisits[i]!.updatedAt))).map((v) => ({ ...v, dirty: 0 as const })),
    );

    // Append-only tables: the server copy is the same record.
    await db.observations.bulkPut(c.observations.map((o) => ({ ...o, dirty: 0 as const })));
    await db.escalations.bulkPut(c.escalations.map((e) => ({ ...e, dirty: 0 as const })));
    await db.movements.bulkPut(c.movements.map((m) => ({ ...m, dirty: 0 as const })));
    // Instruments are managed on the dashboard only.
    if (c.equipment?.length) await db.equipment.bulkPut(c.equipment);

    await setMeta("pullCursor", data.cursor, db);
    await setMeta("roster", data.staff, db);
    await setMeta("mewsConfig", data.facility.mewsConfig, db);
    const device = await getMeta("device", db);
    if (device && device.facility.name !== data.facility.name) await setMeta("device", { ...device, facility: { ...device.facility, name: data.facility.name } }, db);
  });
}
