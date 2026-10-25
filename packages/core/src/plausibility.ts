/**
 * Data-entry safety checks. "Hard" limits reject a value outright (almost
 * certainly a typo, e.g. HR 1200). "Soft" limits are physiologically possible
 * but extreme, so the nurse must confirm before saving.
 */
import type { VitalsInput } from "./mews";

export type CheckedVital = "rr" | "hr" | "sbp" | "dbp" | "tempC" | "spo2";

interface Limits {
  hard: [number, number];
  soft: [number, number];
}

export const VITAL_LIMITS: Record<CheckedVital, Limits> = {
  rr: { hard: [0, 80], soft: [6, 50] },
  hr: { hard: [0, 300], soft: [30, 200] },
  sbp: { hard: [30, 300], soft: [60, 240] },
  dbp: { hard: [10, 200], soft: [30, 140] },
  tempC: { hard: [25, 45], soft: [33, 42] },
  spo2: { hard: [30, 100], soft: [70, 100] },
};

export interface VitalIssue {
  field: CheckedVital | "bp";
  kind: "hard" | "soft";
  /** Stable code for translation, e.g. "out_of_range", "confirm_extreme". */
  code: string;
}

export function checkVitals(v: VitalsInput): VitalIssue[] {
  const issues: VitalIssue[] = [];
  for (const field of Object.keys(VITAL_LIMITS) as CheckedVital[]) {
    const value = v[field];
    if (value == null) continue;
    if (!Number.isFinite(value)) {
      issues.push({ field, kind: "hard", code: "not_a_number" });
      continue;
    }
    const { hard, soft } = VITAL_LIMITS[field];
    if (value < hard[0] || value > hard[1]) issues.push({ field, kind: "hard", code: "out_of_range" });
    else if (value < soft[0] || value > soft[1]) issues.push({ field, kind: "soft", code: "confirm_extreme" });
  }
  if (v.sbp != null && v.dbp != null && Number.isFinite(v.sbp) && Number.isFinite(v.dbp) && v.dbp >= v.sbp) {
    issues.push({ field: "bp", kind: "hard", code: "dbp_not_below_sbp" });
  }
  // A temperature in the Fahrenheit range was probably entered in the wrong unit.
  if (v.tempC != null && v.tempC >= 90 && v.tempC <= 110) {
    issues.push({ field: "tempC", kind: "hard", code: "looks_fahrenheit" });
  }
  return issues;
}

export function hasBlockingIssue(issues: VitalIssue[]): boolean {
  return issues.some((i) => i.kind === "hard");
}

export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}
