/** Read models for the dashboard. */
import {
  computeStock,
  LEVEL_RANK,
  latestByPatient,
  localDate,
  minutesOverdue,
  resolveMewsConfig,
  stockAlerts,
  type MewsConfig,
  type MewsLevel,
} from "@swen/core";
import type { Db } from "./db";

export async function listFacilities(db: Db) {
  return db.facility.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, mewsConfig: true, timeZone: true } });
}

export interface WardRow {
  patient: { id: string; ward: string; bed: string | null; givenName: string; familyName: string; birthYear: number | null; isPregnant: boolean };
  latest: null | {
    id: string;
    recordedAt: Date;
    mewsTotal: number;
    mewsLevel: MewsLevel;
    mewsComplete: boolean;
    spo2: number | null;
    recordedBy: string;
  };
  acknowledged: boolean;
  minutesOverdue: number | null;
}

/** Active patients with their latest effective vitals, sorted by risk. */
export async function wardBoard(db: Db, facilityId: string, now = Date.now()): Promise<{ rows: WardRow[]; config: MewsConfig }> {
  const facility = await db.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { mewsConfig: true } });
  const config = resolveMewsConfig(facility.mewsConfig);
  const patients = await db.patient.findMany({
    where: { facilityId, dischargedAt: null },
    select: { id: true, ward: true, bed: true, givenName: true, familyName: true, birthYear: true, isPregnant: true },
  });
  const ids = patients.map((p) => p.id);
  const since = new Date(now - 14 * 86_400_000);
  const observations = ids.length
    ? await db.observation.findMany({
        where: { patientId: { in: ids }, recordedAt: { gte: since } },
        select: { id: true, patientId: true, recordedAt: true, mewsTotal: true, mewsLevel: true, mewsComplete: true, spo2: true, recordedBy: true, supersedesId: true },
      })
    : [];
  const latest = latestByPatient(observations);
  const latestIds = [...latest.values()].map((o) => o.id);
  const acked = new Set(
    latestIds.length ? (await db.escalation.findMany({ where: { observationId: { in: latestIds } }, select: { observationId: true } })).map((e) => e.observationId) : [],
  );

  const rows: WardRow[] = patients.map((p) => {
    const o = latest.get(p.id);
    if (!o) return { patient: p, latest: null, acknowledged: false, minutesOverdue: null };
    const level = o.mewsLevel as MewsLevel;
    return {
      patient: p,
      latest: { id: o.id, recordedAt: o.recordedAt, mewsTotal: o.mewsTotal, mewsLevel: level, mewsComplete: o.mewsComplete, spo2: o.spo2, recordedBy: o.recordedBy },
      acknowledged: acked.has(o.id),
      minutesOverdue: minutesOverdue(o.recordedAt, level, config, now),
    };
  });

  rows.sort((a, b) => {
    const ra = a.latest ? LEVEL_RANK[a.latest.mewsLevel] : -1;
    const rb = b.latest ? LEVEL_RANK[b.latest.mewsLevel] : -1;
    if (ra !== rb) return rb - ra;
    const ta = a.latest?.mewsTotal ?? -1;
    const tb = b.latest?.mewsTotal ?? -1;
    if (ta !== tb) return tb - ta;
    return `${a.patient.ward}${a.patient.bed}`.localeCompare(`${b.patient.ward}${b.patient.bed}`);
  });
  return { rows, config };
}

export async function inventoryView(db: Db, facilityId: string, now = new Date()) {
  const [items, movements] = await Promise.all([
    db.item.findMany({ where: { facilityId }, orderBy: [{ category: "asc" }, { nameHt: "asc" }] }),
    db.stockMovement.findMany({ where: { facilityId }, select: { itemId: true, type: true, quantity: true, lot: true, expiryDate: true } }),
  ]);
  const stock = computeStock(movements as Parameters<typeof computeStock>[0], localDate(now));
  const alerts = stockAlerts(items, stock, localDate(now));
  return { items, stock, alerts };
}

export async function staffNames(db: Db, facilityId: string): Promise<Map<string, string>> {
  const staff = await db.staff.findMany({ where: { facilityId }, select: { id: true, name: true } });
  return new Map(staff.map((s) => [s.id, s.name]));
}
