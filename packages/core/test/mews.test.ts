import { describe, expect, it } from "vitest";
import { computeMews, DEFAULT_MEWS_CONFIG, resolveMewsConfig, scoreBand, validateMewsConfig } from "../src/mews";

const normal = { rr: 14, hr: 80, sbp: 120, tempC: 37, avpu: "A" as const };

describe("MEWS band boundaries (Subbe 2001)", () => {
  const b = DEFAULT_MEWS_CONFIG.bands;
  it.each([
    [8, 2], [9, 0], [14, 0], [15, 1], [20, 1], [21, 2], [29, 2], [30, 3], [45, 3],
  ])("RR %s → %s", (v, s) => expect(scoreBand(b.rr, v)).toBe(s));

  it.each([
    [35, 2], [40, 2], [41, 1], [50, 1], [51, 0], [100, 0], [101, 1], [110, 1], [111, 2], [129, 2], [130, 3],
  ])("HR %s → %s", (v, s) => expect(scoreBand(b.hr, v)).toBe(s));

  it.each([
    [60, 3], [70, 3], [71, 2], [80, 2], [81, 1], [100, 1], [101, 0], [199, 0], [200, 2],
  ])("SBP %s → %s", (v, s) => expect(scoreBand(b.sbp, v)).toBe(s));

  it.each([
    [34.9, 2], [35, 0], [38.4, 0], [38.5, 2], [40, 2],
  ])("Temp %s → %s", (v, s) => expect(scoreBand(b.tempC, v)).toBe(s));

  it("places decimals on the correct side of each clinical boundary", () => {
    expect(computeMews({ ...normal, tempC: 34.95 }).parts.tempC).toBe(2); // < 35
    expect(computeMews({ ...normal, tempC: 38.45 }).parts.tempC).toBe(0); // < 38.5
    expect(computeMews({ ...normal, tempC: 38.5 }).parts.tempC).toBe(2);
    expect(computeMews({ ...normal, rr: 8.5 }).parts.rr).toBe(2); // < 9
    expect(computeMews({ ...normal, hr: 40.6 }).parts.hr).toBe(2); // still in the "≤40" band
    expect(computeMews({ ...normal, sbp: 70.5 }).parts.sbp).toBe(3);
  });
});

describe("computeMews", () => {
  it("scores a normal adult as 0 / low", () => {
    const r = computeMews(normal);
    expect(r.total).toBe(0);
    expect(r.level).toBe("low");
    expect(r.complete).toBe(true);
    expect(r.applicability).toBe("adult");
    expect(r.recheckMinutes).toBe(240);
  });

  it("flags medium at total 3–4", () => {
    // RR 22 → 2, HR 105 → 1  = 3
    const r = computeMews({ ...normal, rr: 22, hr: 105 });
    expect(r.total).toBe(3);
    expect(r.level).toBe("medium");
    expect(r.reasons).toEqual(["total_medium"]);
    expect(r.recheckMinutes).toBe(60);
  });

  it("flags high at total ≥ 5", () => {
    // RR 25 → 2, HR 115 → 2, Temp 39 → 2 = 6
    const r = computeMews({ ...normal, rr: 25, hr: 115, tempC: 39 });
    expect(r.total).toBe(6);
    expect(r.level).toBe("high");
    expect(r.reasons).toContain("total_high");
  });

  it("flags high when a single parameter scores 3 even if total is low", () => {
    const r = computeMews({ ...normal, avpu: "U" });
    expect(r.total).toBe(3);
    expect(r.level).toBe("high");
    expect(r.reasons).toEqual(["single_avpu"]);
  });

  it("marks incomplete sets and lists what is missing", () => {
    const r = computeMews({ hr: 80, sbp: 120 });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["rr", "tempC", "avpu"]);
    expect(r.flags).toContain("incomplete");
  });

  it("low SpO2 does not change the score but never reads as routine", () => {
    const r = computeMews({ ...normal, spo2: 86 });
    expect(r.total).toBe(0);
    expect(r.flags).toContain("spo2_low");
    expect(r.level).toBe("medium");
    expect(r.reasons).toEqual(["spo2_low"]);
    // An entry of SpO2 alone is medium and incomplete.
    const only = computeMews({ spo2: 82 });
    expect(only.level).toBe("medium");
    expect(only.complete).toBe(false);
  });

  it("marks children and pregnancy as not validated", () => {
    expect(computeMews(normal, { ageYears: 10 }).applicability).toBe("not_validated");
    expect(computeMews(normal, { ageYears: 10 }).flags).toContain("pediatric_use_pews");
    expect(computeMews(normal, { isPregnant: true }).flags).toContain("pregnant_use_meows");
    expect(computeMews(normal, { ageYears: 40 }).applicability).toBe("adult");
  });

  it("ignores null / NaN values", () => {
    const r = computeMews({ ...normal, hr: Number.NaN, rr: null });
    expect(r.missing).toEqual(["rr", "hr"]);
  });
});

describe("config validation", () => {
  it("accepts the default config", () => {
    expect(validateMewsConfig(DEFAULT_MEWS_CONFIG)).toEqual([]);
  });

  it("rejects bands out of order and a missing open-ended band", () => {
    const bad = structuredClone(DEFAULT_MEWS_CONFIG);
    bad.bands.hr = [{ below: 100, score: 0 }, { below: 50, score: 1 }];
    const problems = validateMewsConfig(bad);
    expect(problems.some((p) => p.includes("bands.hr"))).toBe(true);
  });

  it("rejects medium >= high", () => {
    const bad = structuredClone(DEFAULT_MEWS_CONFIG);
    bad.levels.medium = 5;
    expect(validateMewsConfig(bad)).toContain("levels: medium must be lower than high");
  });

  it("falls back to the default for garbage", () => {
    expect(resolveMewsConfig({ nope: true })).toBe(DEFAULT_MEWS_CONFIG);
    expect(resolveMewsConfig(null)).toBe(DEFAULT_MEWS_CONFIG);
  });

  it("uses facility thresholds when provided", () => {
    const cfg = structuredClone(DEFAULT_MEWS_CONFIG);
    cfg.levels.high = 4;
    const r = computeMews({ ...normal, rr: 22, hr: 115 }, {}, resolveMewsConfig(cfg)); // 2 + 2 = 4
    expect(r.level).toBe("high");
  });
});
