/** Ward-level views shared by the field app and the dashboard. */
import type { MewsConfig, MewsLevel } from "./mews";

interface ObsLike {
  id: string;
  patientId: string;
  recordedAt: string | Date;
  supersedesId?: string | null;
}

const ts = (v: string | Date) => (typeof v === "string" ? Date.parse(v) : v.getTime());

/** Observations that have not been replaced by a correction. */
export function effectiveObservations<T extends ObsLike>(observations: T[]): T[] {
  const superseded = new Set(observations.map((o) => o.supersedesId).filter((x): x is string => !!x));
  return observations.filter((o) => !superseded.has(o.id));
}

/** Latest effective observation per patient. */
export function latestByPatient<T extends ObsLike>(observations: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const o of effectiveObservations(observations)) {
    const cur = latest.get(o.patientId);
    if (!cur || ts(o.recordedAt) > ts(cur.recordedAt)) latest.set(o.patientId, o);
  }
  return latest;
}

/** Minutes overdue for the next check (negative = not yet due). */
export function minutesOverdue(lastRecordedAt: string | Date, level: MewsLevel, cfg: MewsConfig, now: number = Date.now()): number {
  const due = ts(lastRecordedAt) + cfg.recheckMinutes[level] * 60_000;
  return Math.floor((now - due) / 60_000);
}

export const LEVEL_RANK: Record<MewsLevel, number> = { high: 2, medium: 1, low: 0 };
