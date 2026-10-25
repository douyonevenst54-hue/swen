/**
 * Modified Early Warning Score (MEWS).
 *
 * Default bands follow Subbe et al. (2001), "Validation of a modified Early
 * Warning Score in medical admissions", QJM 94:521-526. Every threshold lives in
 * a config object so a facility's clinical lead can review and change them
 * without touching code (see docs/CLINICAL_SAFETY.md).
 *
 * Bands are evaluated in order: the first band whose `below` is greater than
 * the value wins (`below: null` means "and above"). Upper bounds are exclusive,
 * so decimals fall where the clinical table puts them: 34.95 °C is "< 35" and
 * scores 2; 8.5 breaths/min is "< 9" and scores 2.
 */
import { z } from "zod";

export const AVPU = ["A", "V", "P", "U"] as const;
export type Avpu = (typeof AVPU)[number];

export const VitalKey = z.enum(["rr", "hr", "sbp", "tempC"]);
export type VitalKey = z.infer<typeof VitalKey>;

const Band = z.object({
  /** Exclusive upper bound; null = no upper bound. */
  below: z.number().nullable(),
  score: z.number().int().min(0).max(3),
});
export type Band = z.infer<typeof Band>;

export const MewsConfigSchema = z.object({
  name: z.string().min(1),
  bands: z.object({
    rr: z.array(Band).min(1),
    hr: z.array(Band).min(1),
    sbp: z.array(Band).min(1),
    tempC: z.array(Band).min(1),
  }),
  avpu: z.object({ A: z.number().int(), V: z.number().int(), P: z.number().int(), U: z.number().int() }),
  levels: z.object({
    /** Total score at or above which monitoring should increase. */
    medium: z.number().int().min(1),
    /** Total score at or above which an urgent clinician review is required. */
    high: z.number().int().min(1),
    /** Any single parameter scoring this much also triggers HIGH. */
    singleParameterHigh: z.number().int().min(1).max(3),
  }),
  /** Additional flags that are not part of the score but must be surfaced. */
  flags: z.object({
    spo2Below: z.number().min(50).max(100),
  }),
  /** Patients younger than this are outside the validated adult population. */
  minAdultAgeYears: z.number().int().min(0),
  /** Recommended re-check interval in minutes per level. */
  recheckMinutes: z.object({ low: z.number().int(), medium: z.number().int(), high: z.number().int() }),
});
export type MewsConfig = z.infer<typeof MewsConfigSchema>;

export const DEFAULT_MEWS_CONFIG: MewsConfig = {
  name: "Subbe 2001 MEWS (default)",
  bands: {
    // Respiratory rate (breaths/min): <9 →2, 9–14 →0, 15–20 →1, 21–29 →2, ≥30 →3
    rr: [
      { below: 9, score: 2 },
      { below: 15, score: 0 },
      { below: 21, score: 1 },
      { below: 30, score: 2 },
      { below: null, score: 3 },
    ],
    // Heart rate (bpm): ≤40 →2, 41–50 →1, 51–100 →0, 101–110 →1, 111–129 →2, ≥130 →3
    // (Subbe lists "<40"; 40 itself is placed in the higher-risk band.)
    hr: [
      { below: 41, score: 2 },
      { below: 51, score: 1 },
      { below: 101, score: 0 },
      { below: 111, score: 1 },
      { below: 130, score: 2 },
      { below: null, score: 3 },
    ],
    // Systolic BP (mmHg): ≤70 →3, 71–80 →2, 81–100 →1, 101–199 →0, ≥200 →2
    sbp: [
      { below: 71, score: 3 },
      { below: 81, score: 2 },
      { below: 101, score: 1 },
      { below: 200, score: 0 },
      { below: null, score: 2 },
    ],
    // Temperature (°C): <35 →2, 35–38.4 →0, ≥38.5 →2
    tempC: [
      { below: 35, score: 2 },
      { below: 38.5, score: 0 },
      { below: null, score: 2 },
    ],
  },
  avpu: { A: 0, V: 1, P: 2, U: 3 },
  levels: { medium: 3, high: 5, singleParameterHigh: 3 },
  flags: { spo2Below: 90 },
  minAdultAgeYears: 16,
  recheckMinutes: { low: 240, medium: 60, high: 15 },
};

export interface VitalsInput {
  rr?: number | null;
  hr?: number | null;
  sbp?: number | null;
  dbp?: number | null;
  tempC?: number | null;
  spo2?: number | null;
  avpu?: Avpu | null;
}

export interface PatientContext {
  /** Age in whole years, if known. */
  ageYears?: number | null;
  isPregnant?: boolean | null;
}

export type MewsLevel = "low" | "medium" | "high";
export type ScoredParam = VitalKey | "avpu";

export interface MewsResult {
  total: number;
  level: MewsLevel;
  parts: Partial<Record<ScoredParam, number>>;
  /** Scored parameters that were not provided. */
  missing: ScoredParam[];
  /** True when all five scored parameters were provided. */
  complete: boolean;
  /** Reasons the level is HIGH or MEDIUM, as stable codes for translation. */
  reasons: string[];
  /** Non-score alerts, e.g. low SpO2. */
  flags: string[];
  /** "not_validated" when MEWS should not be relied on for this patient. */
  applicability: "adult" | "not_validated";
  recheckMinutes: number;
}

export function scoreBand(bands: Band[], value: number): number {
  for (const band of bands) {
    if (band.below === null || value < band.below) return band.score;
  }
  // Config without an open-ended last band: treat as the last band's score.
  return bands[bands.length - 1]!.score;
}

const SCORED: ScoredParam[] =["rr", "hr", "sbp", "tempC", "avpu"];

function present(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function computeMews(
  vitals: VitalsInput,
  patient: PatientContext = {},
  config: MewsConfig = DEFAULT_MEWS_CONFIG,
): MewsResult {
  const parts: Partial<Record<ScoredParam, number>> = {};
  const missing: ScoredParam[] = [];

  for (const key of SCORED) {
    if (key === "avpu") {
      if (vitals.avpu) parts.avpu = config.avpu[vitals.avpu];
      else missing.push("avpu");
      continue;
    }
    const value = vitals[key];
    if (present(value)) parts[key] = scoreBand(config.bands[key], value);
    else missing.push(key);
  }

  const total = Object.values(parts).reduce((sum, n) => sum + (n ?? 0), 0);
  const reasons: string[] = [];

  let level: MewsLevel = "low";
  if (total >= config.levels.high) {
    level = "high";
    reasons.push("total_high");
  }
  const singleHigh = (Object.entries(parts) as [ScoredParam, number][])
    .filter(([, s]) => s >= config.levels.singleParameterHigh)
    .map(([k]) => k);
  if (singleHigh.length > 0) {
    level = "high";
    for (const k of singleHigh) reasons.push(`single_${k}`);
  }
  if (level === "low" && total >= config.levels.medium) {
    level = "medium";
    reasons.push("total_medium");
  }

  const flags: string[] = [];
  if (present(vitals.spo2) && vitals.spo2 < config.flags.spo2Below) {
    flags.push("spo2_low");
    // Hypoxaemia is not in the classic score, but must never read as "routine".
    if (level === "low") {
      level = "medium";
      reasons.push("spo2_low");
    }
  }
  if (missing.length > 0) flags.push("incomplete");

  let applicability: MewsResult["applicability"] = "adult";
  if (patient.isPregnant) {
    applicability = "not_validated";
    flags.push("pregnant_use_meows");
  }
  if (present(patient.ageYears) && patient.ageYears < config.minAdultAgeYears) {
    applicability = "not_validated";
    flags.push("pediatric_use_pews");
  }

  return {
    total,
    level,
    parts,
    missing,
    complete: missing.length === 0,
    reasons,
    flags,
    applicability,
    recheckMinutes: config.recheckMinutes[level],
  };
}

/** Parse and validate a facility-supplied MEWS config, falling back to the default. */
export function resolveMewsConfig(raw: unknown): MewsConfig {
  if (raw == null) return DEFAULT_MEWS_CONFIG;
  const parsed = MewsConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_MEWS_CONFIG;
}

/** Validate a config and return human-readable problems (empty = valid). */
export function validateMewsConfig(raw: unknown): string[] {
  const parsed = MewsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const cfg = parsed.data;
  const problems: string[] = [];
  for (const key of VitalKey.options) {
    const bands = cfg.bands[key];
    for (let i = 1; i < bands.length; i++) {
      const prev = bands[i - 1]!.below;
      const cur = bands[i]!.below;
      if (prev === null) problems.push(`bands.${key}: open-ended band must be last`);
      else if (cur !== null && cur <= prev) problems.push(`bands.${key}: band ${i} "below" must be greater than band ${i - 1}`);
    }
    if (bands[bands.length - 1]!.below !== null) problems.push(`bands.${key}: last band must have below: null`);
  }
  if (cfg.levels.medium >= cfg.levels.high) problems.push("levels: medium must be lower than high");
  return problems;
}
