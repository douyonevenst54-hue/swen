/**
 * Sync service. Pure functions over a Prisma client so they can be tested
 * against a real Postgres without the HTTP layer.
 */
import {
  ageInYears,
  computeMews,
  incomingWins,
  RETRYABLE_REASONS,
  resolveMewsConfig,
  type Equipment,
  type Escalation,
  type Item,
  type Observation,
  type Patient,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type RejectReason,
  type Staff,
  type StockMovement,
  type Visit,
} from "@swen/core";
import type { Db } from "./db";

/** Interactive transaction client. */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

/**
 * Run `fn` in a transaction holding the facility's write lock. Writes for one
 * facility are serialized, so `seq` values become visible in order and a
 * device's pull cursor can never skip a row that commits late.
 */
export async function withFacilityLock<T>(db: Db, facilityId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${facilityId}::text, 0))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export interface DeviceContext {
  facilityId: string;
  deviceId: string;
}

type Rejected = PushResponse["rejected"][number];

function reject(list: Rejected[], id: string, reason: RejectReason) {
  list.push({ id, reason, retryable: RETRYABLE_REASONS.has(reason) });
}

const d = (iso: string) => new Date(iso);
/** Device clocks can be far in the future; such an edit must not win every later one. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const clampFuture = (iso: string, now: Date) => new Date(Math.min(Date.parse(iso), now.getTime() + MAX_CLOCK_SKEW_MS));
const dn = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

export async function pushChanges(db: Db, ctx: DeviceContext, body: PushRequest, now: Date = new Date()): Promise<PushResponse> {
  const accepted: string[] = [];
  const rejected: Rejected[] = [];

  await withFacilityLock(db, ctx.facilityId, async (tx) => {
    const facility = await tx.facility.findUniqueOrThrow({ where: { id: ctx.facilityId }, select: { mewsConfig: true } });
    const mewsConfig = resolveMewsConfig(facility.mewsConfig);
    const staffIds = new Set((await tx.staff.findMany({ where: { facilityId: ctx.facilityId }, select: { id: true } })).map((s) => s.id));

    // ---- Patients (last-write-wins) ----------------------------------------
    const patientIdsInFacility = new Set<string>();
    if (body.patients.length) {
      const existing = new Map(
        (await tx.patient.findMany({ where: { id: { in: body.patients.map((p) => p.id) } }, select: { id: true, facilityId: true, updatedAt: true } })).map((p) => [p.id, p]),
      );
      for (const p of body.patients) {
        const ex = existing.get(p.id);
        if (ex && ex.facilityId !== ctx.facilityId) {
          reject(rejected, p.id, "other_facility");
          continue;
        }
        if (!staffIds.has(p.updatedBy)) {
          reject(rejected, p.id, "unknown_staff");
          continue;
        }
        const data = {
          ward: p.ward,
          bed: p.bed ?? null,
          mrn: p.mrn ?? null,
          givenName: p.givenName,
          familyName: p.familyName,
          otherNames: p.otherNames ?? null,
          sex: p.sex,
          birthYear: p.birthYear ?? null,
          birthDate: p.birthDate ?? null,
          birthDatePrecision: p.birthDatePrecision ?? null,
          isPregnant: p.isPregnant,
          phone: p.phone ?? null,
          motherName: p.motherName ?? null,
          commune: p.commune ?? null,
          address: p.address ?? null,
          nationalId: p.nationalId ?? null,
          emergencyName: p.emergencyName ?? null,
          emergencyRelation: p.emergencyRelation ?? null,
          emergencyPhone: p.emergencyPhone ?? null,
          // `number` is never taken from a device: the server issues it.
          notes: p.notes ?? null,
          dischargedAt: dn(p.dischargedAt),
          updatedAt: clampFuture(p.updatedAt, now),
          updatedBy: p.updatedBy,
          deviceId: ctx.deviceId,
        };
        if (!ex) {
          await tx.patient.create({ data: { id: p.id, facilityId: ctx.facilityId, createdAt: d(p.createdAt), ...data } });
        } else if (incomingWins(ex.updatedAt, data.updatedAt)) {
          await tx.patient.update({ where: { id: p.id }, data });
        } else {
          // The server copy is newer. Touch it so its seq moves past every device's
          // cursor: the device that sent the older copy will pull the newer one back.
          await tx.patient.update({ where: { id: p.id }, data: { updatedAt: ex.updatedAt } });
        }
        accepted.push(p.id);
        patientIdsInFacility.add(p.id);
      }
      await assignPatientNumbers(tx, ctx.facilityId, [...patientIdsInFacility]);
    }

    // ---- Visits (last-write-wins) ------------------------------------------
    if (body.visits.length) {
      const existing = new Map(
        (await tx.visit.findMany({ where: { id: { in: body.visits.map((v) => v.id) } }, select: { id: true, facilityId: true, patientId: true, updatedAt: true } })).map((v) => [v.id, v]),
      );
      const patientsHere = new Set(
        (await tx.patient.findMany({ where: { facilityId: ctx.facilityId, id: { in: [...new Set(body.visits.map((v) => v.patientId))] } }, select: { id: true } })).map((p) => p.id),
      );
      for (const v of body.visits) {
        const ex = existing.get(v.id);
        if (ex && (ex.facilityId !== ctx.facilityId || ex.patientId !== v.patientId)) {
          reject(rejected, v.id, "other_facility");
          continue;
        }
        if (!patientsHere.has(v.patientId)) {
          reject(rejected, v.id, "unknown_patient");
          continue;
        }
        if (!staffIds.has(v.createdBy) || !staffIds.has(v.updatedBy)) {
          reject(rejected, v.id, "unknown_staff");
          continue;
        }
        const data = {
          kind: v.kind,
          service: v.service,
          status: v.status,
          scheduledFor: dn(v.scheduledFor),
          arrivedAt: dn(v.arrivedAt),
          endedAt: dn(v.endedAt),
          triageColor: v.triageColor ?? null,
          chiefComplaint: v.chiefComplaint ?? null,
          assignedTo: v.assignedTo && staffIds.has(v.assignedTo) ? v.assignedTo : null,
          note: v.note ?? null,
          updatedAt: clampFuture(v.updatedAt, now),
          updatedBy: v.updatedBy,
          deviceId: ctx.deviceId,
        };
        if (!ex) await tx.visit.create({ data: { id: v.id, facilityId: ctx.facilityId, patientId: v.patientId, createdAt: d(v.createdAt), createdBy: v.createdBy, ...data } });
        else if (incomingWins(ex.updatedAt, data.updatedAt)) await tx.visit.update({ where: { id: v.id }, data });
        else await tx.visit.update({ where: { id: v.id }, data: { updatedAt: ex.updatedAt } }); // re-send newer copy
        accepted.push(v.id);
      }
    }

    // ---- Items (last-write-wins, code unique per facility) -----------------
    if (body.items.length) {
      const existing = new Map(
        (await tx.item.findMany({ where: { id: { in: body.items.map((i) => i.id) } }, select: { id: true, facilityId: true, updatedAt: true } })).map((i) => [i.id, i]),
      );
      for (const it of body.items) {
        const ex = existing.get(it.id);
        if (ex && ex.facilityId !== ctx.facilityId) {
          reject(rejected, it.id, "other_facility");
          continue;
        }
        const clash = await tx.item.findFirst({ where: { facilityId: ctx.facilityId, code: it.code, NOT: { id: it.id } }, select: { id: true } });
        if (clash) {
          reject(rejected, it.id, "duplicate_code");
          continue;
        }
        const data = {
          code: it.code,
          nameHt: it.nameHt,
          nameFr: it.nameFr,
          unit: it.unit,
          category: it.category ?? null,
          minStock: it.minStock,
          active: it.active,
          updatedAt: clampFuture(it.updatedAt, now),
        };
        if (!ex) await tx.item.create({ data: { id: it.id, facilityId: ctx.facilityId, ...data } });
        else if (incomingWins(ex.updatedAt, data.updatedAt)) await tx.item.update({ where: { id: it.id }, data });
        else await tx.item.update({ where: { id: it.id }, data: { updatedAt: ex.updatedAt } }); // re-send newer copy
        accepted.push(it.id);
      }
    }

    // ---- Observations (append-only) ----------------------------------------
    if (body.observations.length) {
      const known = new Set(
        (await tx.observation.findMany({ where: { id: { in: body.observations.map((o) => o.id) } }, select: { id: true, facilityId: true } }))
          .filter((o) => {
            if (o.facilityId === ctx.facilityId) return true;
            reject(rejected, o.id, "other_facility");
            return false;
          })
          .map((o) => o.id),
      );
      const otherFacility = new Set(rejected.map((r) => r.id));
      const patients = new Map(
        (
          await tx.patient.findMany({
            where: { facilityId: ctx.facilityId, id: { in: [...new Set(body.observations.map((o) => o.patientId))] } },
            select: { id: true, birthYear: true, isPregnant: true },
          })
        ).map((p) => [p.id, p]),
      );
      const equipmentIds = new Set(
        (await tx.equipment.findMany({ where: { facilityId: ctx.facilityId }, select: { id: true } })).map((e) => e.id),
      );
      const visitIds = [...new Set(body.observations.map((o) => o.visitId).filter((x): x is string => !!x))];
      const visitPatient = new Map(
        visitIds.length
          ? (await tx.visit.findMany({ where: { facilityId: ctx.facilityId, id: { in: visitIds } }, select: { id: true, patientId: true } })).map((v) => [v.id, v.patientId])
          : [],
      );
      const toCreate = [];
      for (const o of body.observations) {
        if (otherFacility.has(o.id)) continue;
        if (known.has(o.id)) {
          accepted.push(o.id);
          continue;
        }
        const patient = patients.get(o.patientId);
        if (!patient) {
          reject(rejected, o.id, "unknown_patient");
          continue;
        }
        if (!staffIds.has(o.recordedBy)) {
          reject(rejected, o.id, "unknown_staff");
          continue;
        }
        const recordedAt = d(o.recordedAt);
        const mews = computeMews(o, { ageYears: ageInYears(patient.birthYear, recordedAt), isPregnant: patient.isPregnant }, mewsConfig);
        toCreate.push({
          id: o.id,
          facilityId: ctx.facilityId,
          patientId: o.patientId,
          recordedAt,
          recordedBy: o.recordedBy,
          rr: o.rr ?? null,
          hr: o.hr ?? null,
          sbp: o.sbp ?? null,
          dbp: o.dbp ?? null,
          tempC: o.tempC ?? null,
          spo2: o.spo2 ?? null,
          avpu: o.avpu ?? null,
          sources: o.sources ?? {},
          deviceMewsTotal: o.mewsTotal ?? null,
          deviceMewsLevel: o.mewsLevel ?? null,
          mewsTotal: mews.total,
          mewsLevel: mews.level,
          mewsComplete: mews.complete,
          supersedesId: o.supersedesId ?? null,
          note: o.note ?? null,
          patientScanned: o.patientScanned ?? false,
          // Keep only instruments registered to this facility.
          equipment: Object.fromEntries(Object.entries(o.equipment ?? {}).filter(([, id]) => equipmentIds.has(id))),
          // Link to the visit only if it is this patient's visit in this facility.
          visitId: o.visitId && visitPatient.get(o.visitId) === o.patientId ? o.visitId : null,
          deviceId: ctx.deviceId,
        });
        accepted.push(o.id);
      }
      if (toCreate.length) await tx.observation.createMany({ data: toCreate, skipDuplicates: true });
    }

    // ---- Escalations (append-only) -----------------------------------------
    if (body.escalations.length) {
      const known = new Set((await tx.escalation.findMany({ where: { id: { in: body.escalations.map((e) => e.id) }, facilityId: ctx.facilityId }, select: { id: true } })).map((e) => e.id));
      const observations = new Map(
        (
          await tx.observation.findMany({
            where: { facilityId: ctx.facilityId, id: { in: [...new Set(body.escalations.map((e) => e.observationId))] } },
            select: { id: true, patientId: true },
          })
        ).map((o) => [o.id, o]),
      );
      const toCreate = [];
      for (const e of body.escalations) {
        if (known.has(e.id)) {
          accepted.push(e.id);
          continue;
        }
        const obs = observations.get(e.observationId);
        if (!obs || obs.patientId !== e.patientId) {
          reject(rejected, e.id, "unknown_observation");
          continue;
        }
        if (!staffIds.has(e.by)) {
          reject(rejected, e.id, "unknown_staff");
          continue;
        }
        toCreate.push({ id: e.id, facilityId: ctx.facilityId, observationId: e.observationId, patientId: e.patientId, action: e.action, at: d(e.at), by: e.by, note: e.note ?? null, deviceId: ctx.deviceId });
        accepted.push(e.id);
      }
      if (toCreate.length) await tx.escalation.createMany({ data: toCreate, skipDuplicates: true });
    }

    // ---- Stock movements (append-only) -------------------------------------
    if (body.movements.length) {
      const known = new Set((await tx.stockMovement.findMany({ where: { id: { in: body.movements.map((m) => m.id) }, facilityId: ctx.facilityId }, select: { id: true } })).map((m) => m.id));
      const items = new Set(
        (await tx.item.findMany({ where: { facilityId: ctx.facilityId, id: { in: [...new Set(body.movements.map((m) => m.itemId))] } }, select: { id: true } })).map((i) => i.id),
      );
      const toCreate = [];
      for (const m of body.movements) {
        if (known.has(m.id)) {
          accepted.push(m.id);
          continue;
        }
        if (!items.has(m.itemId)) {
          reject(rejected, m.id, "unknown_item");
          continue;
        }
        if (!staffIds.has(m.by)) {
          reject(rejected, m.id, "unknown_staff");
          continue;
        }
        toCreate.push({
          id: m.id,
          facilityId: ctx.facilityId,
          itemId: m.itemId,
          type: m.type,
          quantity: m.quantity,
          lot: m.lot ?? null,
          expiryDate: m.expiryDate ?? null,
          location: m.location ?? null,
          patientId: m.patientId ?? null,
          at: d(m.at),
          by: m.by,
          note: m.note ?? null,
          deviceId: ctx.deviceId,
        });
        accepted.push(m.id);
      }
      if (toCreate.length) await tx.stockMovement.createMany({ data: toCreate, skipDuplicates: true });
    }
  });

  return { accepted, rejected, serverTime: now.toISOString() };
}

/** Prefix from the facility name: "Hôpital Universitaire de Lamesine" → "HUL". */
export function defaultPrefix(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 2 || /^[A-Z0-9]+$/.test(w))
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (letters || "SW").slice(0, 4);
}

/**
 * Give a number to every listed patient that has none, in the facility's own
 * series. Runs inside the facility lock, so numbers are never issued twice.
 */
export async function assignPatientNumbers(tx: Tx, facilityId: string, patientIds: string[]): Promise<void> {
  if (!patientIds.length) return;
  const missing = await tx.patient.findMany({ where: { facilityId, id: { in: patientIds }, number: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!missing.length) return;
  const facility = await tx.facility.update({
    where: { id: facilityId },
    data: { patientCounter: { increment: missing.length } },
    select: { name: true, patientPrefix: true, patientCounter: true },
  });
  const prefix = facility.patientPrefix?.trim() || defaultPrefix(facility.name);
  let n = facility.patientCounter - missing.length;
  for (const p of missing) {
    n++;
    await tx.patient.update({ where: { id: p.id }, data: { number: `${prefix}-${String(n).padStart(6, "0")}` } });
  }
}

// ---- Pull --------------------------------------------------------------------

const iso = (v: Date) => v.toISOString();
const isoN = (v: Date | null) => (v ? v.toISOString() : null);

export const toPatient = (p: {
  id: string; ward: string; bed: string | null; mrn: string | null; givenName: string; familyName: string; otherNames: string | null; sex: string;
  birthYear: number | null; birthDate: string | null; birthDatePrecision: string | null; isPregnant: boolean;
  phone: string | null; motherName: string | null; commune: string | null; address: string | null; nationalId: string | null;
  emergencyName: string | null; emergencyRelation: string | null; emergencyPhone: string | null; number: string | null;
  notes: string | null; dischargedAt: Date | null; createdAt: Date; updatedAt: Date; updatedBy: string;
}): Patient => ({
  id: p.id, ward: p.ward, bed: p.bed, mrn: p.mrn, givenName: p.givenName, familyName: p.familyName, otherNames: p.otherNames, sex: p.sex as Patient["sex"],
  birthYear: p.birthYear, birthDate: p.birthDate, birthDatePrecision: p.birthDatePrecision as Patient["birthDatePrecision"], isPregnant: p.isPregnant,
  phone: p.phone, motherName: p.motherName, commune: p.commune, address: p.address, nationalId: p.nationalId,
  emergencyName: p.emergencyName, emergencyRelation: p.emergencyRelation, emergencyPhone: p.emergencyPhone, number: p.number,
  notes: p.notes, dischargedAt: isoN(p.dischargedAt),
  createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt), updatedBy: p.updatedBy,
});

export const toVisit = (v: {
  id: string; patientId: string; kind: string; service: string; status: string; scheduledFor: Date | null; arrivedAt: Date | null; endedAt: Date | null;
  triageColor: string | null; chiefComplaint: string | null; assignedTo: string | null; note: string | null;
  createdAt: Date; createdBy: string; updatedAt: Date; updatedBy: string;
}): Visit => ({
  id: v.id, patientId: v.patientId, kind: v.kind as Visit["kind"], service: v.service, status: v.status as Visit["status"],
  scheduledFor: isoN(v.scheduledFor), arrivedAt: isoN(v.arrivedAt), endedAt: isoN(v.endedAt),
  triageColor: v.triageColor as Visit["triageColor"], chiefComplaint: v.chiefComplaint, assignedTo: v.assignedTo, note: v.note,
  createdAt: iso(v.createdAt), createdBy: v.createdBy, updatedAt: iso(v.updatedAt), updatedBy: v.updatedBy,
});

export const toObservation = (o: {
  id: string; patientId: string; recordedAt: Date; recordedBy: string; rr: number | null; hr: number | null; sbp: number | null; dbp: number | null;
  tempC: number | null; spo2: number | null; avpu: string | null; sources: unknown; mewsTotal: number; mewsLevel: string; supersedesId: string | null; note: string | null;
  patientScanned: boolean; equipment: unknown; visitId: string | null;
}): Observation => ({
  id: o.id, patientId: o.patientId, recordedAt: iso(o.recordedAt), recordedBy: o.recordedBy,
  rr: o.rr, hr: o.hr, sbp: o.sbp, dbp: o.dbp, tempC: o.tempC, spo2: o.spo2, avpu: o.avpu as Observation["avpu"],
  sources: (o.sources ?? {}) as Observation["sources"], mewsTotal: o.mewsTotal, mewsLevel: o.mewsLevel as Observation["mewsLevel"],
  supersedesId: o.supersedesId, note: o.note,
  patientScanned: o.patientScanned, equipment: (o.equipment ?? {}) as Observation["equipment"], visitId: o.visitId,
});

export const toEquipment = (e: {
  id: string; code: string; name: string; kind: string; serial: string | null; lastCheckedAt: Date | null; active: boolean; updatedAt: Date;
}): Equipment => ({
  id: e.id, code: e.code, name: e.name, kind: e.kind as Equipment["kind"], serial: e.serial,
  lastCheckedAt: isoN(e.lastCheckedAt), active: e.active, updatedAt: iso(e.updatedAt),
});

export const toEscalation = (e: { id: string; observationId: string; patientId: string; action: string; at: Date; by: string; note: string | null }): Escalation => ({
  id: e.id, observationId: e.observationId, patientId: e.patientId, action: e.action as Escalation["action"], at: iso(e.at), by: e.by, note: e.note,
});

export const toItem = (i: { id: string; code: string; nameHt: string; nameFr: string; unit: string; category: string | null; minStock: number; active: boolean; updatedAt: Date }): Item => ({
  id: i.id, code: i.code, nameHt: i.nameHt, nameFr: i.nameFr, unit: i.unit, category: i.category, minStock: i.minStock, active: i.active, updatedAt: iso(i.updatedAt),
});

export const toMovement = (m: {
  id: string; itemId: string; type: string; quantity: number; lot: string | null; expiryDate: string | null; location: string | null;
  patientId: string | null; at: Date; by: string; note: string | null;
}): StockMovement => ({
  id: m.id, itemId: m.itemId, type: m.type as StockMovement["type"], quantity: m.quantity, lot: m.lot, expiryDate: m.expiryDate,
  location: m.location, patientId: m.patientId, at: iso(m.at), by: m.by, note: m.note,
});

export const toStaff = (s: { id: string; name: string; role: string; active: boolean; pinSetAt: Date }): Staff => ({
  id: s.id, name: s.name, role: s.role as Staff["role"], active: s.active, pinSetAt: s.pinSetAt.toISOString(),
});

export async function listStaff(db: Db | Tx, facilityId: string): Promise<Staff[]> {
  const rows = await db.staff.findMany({ where: { facilityId }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, active: true, pinSetAt: true } });
  return rows.map(toStaff);
}

export const PULL_LIMIT = 500;

export async function pullChanges(db: Db, facilityId: string, cursorRaw: string | null, limit = PULL_LIMIT, now: Date = new Date()): Promise<PullResponse> {
  const cursor = parseCursor(cursorRaw);
  const where = { facilityId, seq: { gt: cursor } };
  const page = { orderBy: { seq: "asc" as const }, take: limit + 1 };

  // All reads must come from ONE snapshot. Otherwise a push committing between
  // two queries could put a later seq in this page and an earlier one in no page.
  const [facility, staff, patients, visits, observations, escalations, items, movements, equipment] = await db.$transaction(
    async (tx) => [
      await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { id: true, name: true, mewsConfig: true } }),
      await listStaff(tx, facilityId),
      await tx.patient.findMany({ where, ...page }),
      await tx.visit.findMany({ where, ...page }),
      await tx.observation.findMany({ where, ...page }),
      await tx.escalation.findMany({ where, ...page }),
      await tx.item.findMany({ where, ...page }),
      await tx.stockMovement.findMany({ where, ...page }),
      await tx.equipment.findMany({ where, ...page }),
    ] as const,
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 },
  );

  type Tagged =
    | { seq: bigint; kind: "patients"; v: Patient }
    | { seq: bigint; kind: "visits"; v: Visit }
    | { seq: bigint; kind: "observations"; v: Observation }
    | { seq: bigint; kind: "escalations"; v: Escalation }
    | { seq: bigint; kind: "items"; v: Item }
    | { seq: bigint; kind: "movements"; v: StockMovement }
    | { seq: bigint; kind: "equipment"; v: Equipment };

  const all: Tagged[] = [
    ...patients.map((r) => ({ seq: r.seq, kind: "patients" as const, v: toPatient(r) })),
    ...visits.map((r) => ({ seq: r.seq, kind: "visits" as const, v: toVisit(r) })),
    ...observations.map((r) => ({ seq: r.seq, kind: "observations" as const, v: toObservation(r) })),
    ...escalations.map((r) => ({ seq: r.seq, kind: "escalations" as const, v: toEscalation(r) })),
    ...items.map((r) => ({ seq: r.seq, kind: "items" as const, v: toItem(r) })),
    ...movements.map((r) => ({ seq: r.seq, kind: "movements" as const, v: toMovement(r) })),
    ...equipment.map((r) => ({ seq: r.seq, kind: "equipment" as const, v: toEquipment(r) })),
  ].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));

  const taken = all.slice(0, limit);
  const changes: PullResponse["changes"] = { patients: [], visits: [], observations: [], escalations: [], items: [], movements: [], equipment: [] };
  for (const t of taken) (changes[t.kind] as unknown[]).push(t.v);

  return {
    cursor: (taken.length ? taken[taken.length - 1]!.seq : cursor).toString(),
    hasMore: all.length > limit,
    serverTime: now.toISOString(),
    facility: { id: facility.id, name: facility.name, mewsConfig: facility.mewsConfig ?? null },
    staff,
    changes,
  };
}

export function parseCursor(raw: string | null | undefined): bigint {
  if (!raw || !/^\d{1,19}$/.test(raw)) return 0n;
  return BigInt(raw);
}
