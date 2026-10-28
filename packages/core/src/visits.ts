/** The waiting queue: which visits are open today and who should be seen next. */
import type { TriageColor, Visit, VisitStatus } from "./schemas";

/** Statuses that are still in the queue. */
export const OPEN_STATUSES: ReadonlySet<VisitStatus> = new Set(["waiting", "triaged", "consulting"]);

/** Order of the colours, most urgent first. */
export const TRIAGE_RANK: Record<TriageColor, number> = { red: 0, orange: 1, yellow: 2, green: 3 };

/**
 * Target time to be seen by a clinician for each colour, in minutes
 * (South African Triage Scale): red immediately, orange within 10 min,
 * yellow within 1 h, green within 4 h.
 */
export const TRIAGE_TARGET_MIN: Record<TriageColor, number> = { red: 0, orange: 10, yellow: 60, green: 240 };

/** Calendar day (YYYY-MM-DD) of an instant in the facility's time zone. */
export function localDay(at: string | Date, timeZone = "America/Port-au-Prince"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** The day a visit belongs to: the appointment day for a booking, else the arrival (or creation) day. */
export function visitDay(v: Pick<Visit, "status" | "scheduledFor" | "arrivedAt" | "createdAt">, timeZone?: string): string {
  const when = v.status === "booked" ? (v.scheduledFor ?? v.createdAt) : (v.arrivedAt ?? v.createdAt);
  return localDay(when, timeZone);
}

export function minutesSince(at: string | null | undefined, now: number = Date.now()): number | null {
  if (!at) return null;
  return Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
}

/** Minutes past the colour's target wait, or null if not triaged or not late. */
export function minutesPastTarget(v: Pick<Visit, "triageColor" | "arrivedAt" | "status">, now: number = Date.now()): number | null {
  if (!v.triageColor || v.status !== "triaged") return null;
  const waited = minutesSince(v.arrivedAt, now);
  if (waited == null) return null;
  const late = waited - TRIAGE_TARGET_MIN[v.triageColor];
  return late > 0 ? late : null;
}

/**
 * Queue order: emergencies and the most urgent colour first, then whoever has
 * waited longest. Untriaged patients are ordered by arrival.
 */
export function compareQueue(a: Visit, b: Visit): number {
  const ka = a.kind === "emergency" ? 0 : 1;
  const kb = b.kind === "emergency" ? 0 : 1;
  if (ka !== kb) return ka - kb;
  const ra = a.triageColor ? TRIAGE_RANK[a.triageColor] : 9;
  const rb = b.triageColor ? TRIAGE_RANK[b.triageColor] : 9;
  if (ra !== rb) return ra - rb;
  return (a.arrivedAt ?? a.createdAt).localeCompare(b.arrivedAt ?? b.createdAt);
}

/** Allowed status changes; anything else is a mistake in the screen. */
const NEXT: Record<VisitStatus, VisitStatus[]> = {
  booked: ["waiting", "cancelled"],
  waiting: ["triaged", "consulting", "left", "done"],
  triaged: ["consulting", "left", "done"],
  consulting: ["done", "triaged"],
  done: [],
  left: ["waiting"],
  cancelled: ["booked"],
};

export function canMove(from: VisitStatus, to: VisitStatus): boolean {
  return NEXT[from].includes(to);
}
