/**
 * Tablet clocks in the field are often wrong (dead battery, never set). The
 * server reports its time on every sync; the device keeps the offset and uses
 * corrected time for every record it creates.
 */
export function clockOffsetMs(serverTimeIso: string, sentAtMs: number, receivedAtMs: number): number {
  const server = Date.parse(serverTimeIso);
  if (!Number.isFinite(server)) return 0;
  // Assume the server stamped the response halfway through the round trip.
  const localMid = sentAtMs + (receivedAtMs - sentAtMs) / 2;
  return Math.round(server - localMid);
}

export function correctedNow(offsetMs: number, now: number = Date.now()): Date {
  return new Date(now + offsetMs);
}

/** Local calendar date (YYYY-MM-DD) for a date in a given IANA time zone. */
export function localDate(d: Date, timeZone = "America/Port-au-Prince"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function ageInYears(birthYear: number | null | undefined, now: Date = new Date()): number | null {
  if (!birthYear) return null;
  return now.getUTCFullYear() - birthYear;
}

/** Last-write-wins: true when `incoming` should replace `existing`. Ties keep the existing copy. */
export function incomingWins(existingUpdatedAt: string | Date, incomingUpdatedAt: string | Date): boolean {
  const a = typeof existingUpdatedAt === "string" ? Date.parse(existingUpdatedAt) : existingUpdatedAt.getTime();
  const b = typeof incomingUpdatedAt === "string" ? Date.parse(incomingUpdatedAt) : incomingUpdatedAt.getTime();
  return b > a;
}
