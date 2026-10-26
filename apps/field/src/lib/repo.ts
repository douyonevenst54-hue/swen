/** Local data access. All writes are marked dirty for the next sync. */
import {
  ageInYears,
  computeMews,
  correctedNow,
  resolveMewsConfig,
  type Avpu,
  type Escalation,
  type EscalationAction,
  type Item,
  type MewsConfig,
  type MewsResult,
  type Observation,
  type Patient,
  type StockMovement,
} from "@swen/core";
import { open, seal } from "./crypto";
import { getMeta, localDb, type MovementRow, type ObservationRow, type PatientPrivate, type PatientRow, type SwenDb } from "./db";
import type { Session } from "./session";

export type LocalPatient = Patient & { dirty: 0 | 1 | 2 };

export async function nowIso(db: SwenDb = localDb()): Promise<string> {
  return correctedNow((await getMeta("clockOffsetMs", db)) ?? 0).toISOString();
}

/**
 * Timestamp for an edit: never earlier than the version being edited, so an
 * edit always beats the copy it was based on, even if this tablet's clock is behind.
 */
export async function editTime(previous: string | undefined, db: SwenDb = localDb()): Promise<string> {
  const now = Date.parse(await nowIso(db));
  const floor = previous ? Date.parse(previous) + 1 : 0;
  return new Date(Math.max(now, floor)).toISOString();
}

export async function mewsConfig(db: SwenDb = localDb()): Promise<MewsConfig> {
  return resolveMewsConfig(await getMeta("mewsConfig", db));
}

// ---- Patients -----------------------------------------------------------------

export async function sealPatient(key: CryptoKey, p: Patient, dirty: 0 | 1): Promise<PatientRow> {
  const priv: PatientPrivate = {
    givenName: p.givenName,
    familyName: p.familyName,
    mrn: p.mrn ?? null,
    notes: p.notes ?? null,
    sex: p.sex,
    birthYear: p.birthYear ?? null,
    isPregnant: p.isPregnant,
  };
  return {
    id: p.id,
    ward: p.ward,
    bed: p.bed ?? null,
    dischargedAt: p.dischargedAt ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    updatedBy: p.updatedBy,
    enc: await seal(key, priv),
    dirty,
  };
}

export async function openPatient(key: CryptoKey, row: PatientRow): Promise<LocalPatient> {
  const priv = await open<PatientPrivate>(key, row.enc);
  return {
    id: row.id,
    ward: row.ward,
    bed: row.bed,
    dischargedAt: row.dischargedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    ...priv,
    dirty: row.dirty,
  };
}

export async function listPatients(session: Session, opts: { includeDischarged?: boolean } = {}, db: SwenDb = localDb()): Promise<LocalPatient[]> {
  const rows = await db.patients.toArray();
  const out = await Promise.all(rows.filter((r) => opts.includeDischarged || !r.dischargedAt).map((r) => openPatient(session.key, r)));
  return out;
}

export async function getPatient(session: Session, id: string, db: SwenDb = localDb()): Promise<LocalPatient | null> {
  const row = await db.patients.get(id);
  return row ? openPatient(session.key, row) : null;
}

export type PatientInput = Pick<Patient, "ward" | "givenName" | "familyName" | "sex"> &
  Partial<Pick<Patient, "bed" | "mrn" | "birthYear" | "isPregnant" | "notes">>;

export async function savePatient(session: Session, input: PatientInput & { id?: string }, db: SwenDb = localDb()): Promise<Patient> {
  const existing = input.id ? await getPatient(session, input.id, db) : null;
  const now = await editTime(existing?.updatedAt, db);
  const patient: Patient = {
    id: existing?.id ?? crypto.randomUUID(),
    ward: input.ward.trim(),
    bed: input.bed?.trim() || null,
    mrn: input.mrn?.trim() || null,
    givenName: input.givenName.trim(),
    familyName: input.familyName.trim(),
    sex: input.sex,
    birthYear: input.birthYear ?? null,
    isPregnant: input.isPregnant ?? false,
    notes: input.notes?.trim() || null,
    dischargedAt: existing?.dischargedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy: session.staff.id,
  };
  await db.patients.put(await sealPatient(session.key, patient, 1));
  return patient;
}

export async function setDischarged(session: Session, id: string, discharged: boolean, db: SwenDb = localDb()): Promise<void> {
  const p = await getPatient(session, id, db);
  if (!p) return;
  const now = await editTime(p.updatedAt, db);
  const { dirty: _dirty, ...rest } = p;
  void _dirty;
  await db.patients.put(await sealPatient(session.key, { ...rest, dischargedAt: discharged ? now : null, updatedAt: now, updatedBy: session.staff.id }, 1));
}

// ---- Observations ---------------------------------------------------------------

export interface VitalsDraft {
  rr?: number | null;
  hr?: number | null;
  sbp?: number | null;
  dbp?: number | null;
  tempC?: number | null;
  spo2?: number | null;
  avpu?: Avpu | null;
  sources?: Observation["sources"];
  note?: string | null;
  /** The patient's wristband was scanned and matched. */
  patientScanned?: boolean;
  /** Instrument per vital sign. */
  equipment?: Observation["equipment"];
}

export function scoreFor(patient: Pick<Patient, "birthYear" | "isPregnant">, v: VitalsDraft, cfg: MewsConfig, at: Date = new Date()): MewsResult {
  return computeMews(v, { ageYears: ageInYears(patient.birthYear, at), isPregnant: patient.isPregnant }, cfg);
}

export async function addObservation(
  session: Session,
  patient: Pick<Patient, "id" | "birthYear" | "isPregnant">,
  v: VitalsDraft,
  opts: { supersedes?: Observation } = {},
  db: SwenDb = localDb(),
): Promise<{ observation: Observation; mews: MewsResult }> {
  const cfg = await mewsConfig(db);
  // A correction keeps the time the measurement was originally taken.
  const recordedAt = opts.supersedes?.recordedAt ?? (await nowIso(db));
  const mews = scoreFor(patient, v, cfg, new Date(recordedAt));
  const observation: Observation = {
    id: crypto.randomUUID(),
    patientId: patient.id,
    recordedAt,
    recordedBy: session.staff.id,
    rr: v.rr ?? null,
    hr: v.hr ?? null,
    sbp: v.sbp ?? null,
    dbp: v.dbp ?? null,
    tempC: v.tempC ?? null,
    spo2: v.spo2 ?? null,
    avpu: v.avpu ?? null,
    sources: v.sources ?? {},
    mewsTotal: mews.total,
    mewsLevel: mews.level,
    supersedesId: opts.supersedes?.id ?? null,
    note: v.note?.trim() || null,
    patientScanned: v.patientScanned ?? false,
    equipment: v.equipment ?? {},
  };
  await db.observations.put({ ...observation, dirty: 1 });
  return { observation, mews };
}

export async function observationsFor(patientId: string, db: SwenDb = localDb()): Promise<ObservationRow[]> {
  const rows = await db.observations.where("patientId").equals(patientId).toArray();
  return rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export async function recentObservations(sinceIso: string, db: SwenDb = localDb()): Promise<ObservationRow[]> {
  return db.observations.where("recordedAt").aboveOrEqual(sinceIso).toArray();
}

// ---- Escalations ----------------------------------------------------------------

export async function addEscalation(
  session: Session,
  obs: Pick<Observation, "id" | "patientId">,
  action: EscalationAction,
  note: string | null,
  db: SwenDb = localDb(),
): Promise<Escalation> {
  const e: Escalation = { id: crypto.randomUUID(), observationId: obs.id, patientId: obs.patientId, action, at: await nowIso(db), by: session.staff.id, note: note?.trim() || null };
  await db.escalations.put({ ...e, dirty: 1 });
  return e;
}

export async function escalationsFor(patientId: string, db: SwenDb = localDb()) {
  return db.escalations.where("patientId").equals(patientId).toArray();
}

export async function acknowledgedObservationIds(observationIds: string[], db: SwenDb = localDb()): Promise<Set<string>> {
  if (!observationIds.length) return new Set();
  const rows = await db.escalations.where("observationId").anyOf(observationIds).toArray();
  return new Set(rows.map((r) => r.observationId));
}

// ---- Inventory --------------------------------------------------------------------

export async function listItems(db: SwenDb = localDb()): Promise<Item[]> {
  return (await db.items.toArray()).sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.nameHt.localeCompare(b.nameHt));
}

export async function itemByCode(code: string, db: SwenDb = localDb()): Promise<Item | undefined> {
  return db.items.where("code").equalsIgnoreCase(code).first();
}

export async function allMovements(db: SwenDb = localDb()): Promise<MovementRow[]> {
  return db.movements.toArray();
}

export async function movementsFor(itemId: string, db: SwenDb = localDb()): Promise<MovementRow[]> {
  const rows = await db.movements.where("itemId").equals(itemId).toArray();
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

export type MovementInput = Pick<StockMovement, "itemId" | "type" | "quantity"> & Partial<Pick<StockMovement, "lot" | "expiryDate" | "patientId" | "note" | "location">>;

export async function addMovements(session: Session, inputs: MovementInput[], db: SwenDb = localDb()): Promise<StockMovement[]> {
  const at = await nowIso(db);
  const rows: MovementRow[] = inputs.map((m) => ({
    id: crypto.randomUUID(),
    itemId: m.itemId,
    type: m.type,
    quantity: Math.abs(Math.trunc(m.quantity)),
    lot: m.lot?.trim() || null,
    expiryDate: m.expiryDate || null,
    location: m.location ?? null,
    patientId: m.patientId ?? null,
    at,
    by: session.staff.id,
    note: m.note?.trim() || null,
    dirty: 1,
  }));
  await db.movements.bulkPut(rows);
  return rows.map(({ dirty: _d, ...m }) => (void _d, m));
}

// ---- Sync status ------------------------------------------------------------------

export async function pendingCount(db: SwenDb = localDb()): Promise<number> {
  const counts = await Promise.all([
    db.patients.where("dirty").equals(1).count(),
    db.observations.where("dirty").equals(1).count(),
    db.escalations.where("dirty").equals(1).count(),
    db.items.where("dirty").equals(1).count(),
    db.movements.where("dirty").equals(1).count(),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

// ---- Measuring instruments ------------------------------------------------------

export async function equipmentByCode(code: string, db: SwenDb = localDb()) {
  return db.equipment.where("code").equalsIgnoreCase(code.trim()).first();
}

export async function listEquipment(db: SwenDb = localDb()) {
  return db.equipment.toArray();
}
