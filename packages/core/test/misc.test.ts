import { describe, expect, it } from "vitest";
import { checkVitals, hasBlockingIssue } from "../src/plausibility";
import { clockOffsetMs, incomingWins } from "../src/time";
import { en, fr, ht, translate } from "../src/i18n";
import { describeMews } from "../src/labels";
import { computeMews, DEFAULT_MEWS_CONFIG } from "../src/mews";
import { createTranslator } from "../src/i18n";
import { ObservationSchema, PushRequestSchema } from "../src/schemas";

describe("plausibility", () => {
  it("blocks impossible values and warns on extreme ones", () => {
    expect(hasBlockingIssue(checkVitals({ hr: 1200 }))).toBe(true);
    const soft = checkVitals({ hr: 210 });
    expect(soft).toEqual([{ field: "hr", kind: "soft", code: "confirm_extreme" }]);
    expect(hasBlockingIssue(soft)).toBe(false);
  });
  it("catches diastolic >= systolic and Fahrenheit entries", () => {
    expect(checkVitals({ sbp: 80, dbp: 90 }).map((i) => i.code)).toContain("dbp_not_below_sbp");
    expect(checkVitals({ tempC: 98.6 }).map((i) => i.code)).toContain("looks_fahrenheit");
  });
  it("accepts a normal set", () => {
    expect(checkVitals({ rr: 16, hr: 80, sbp: 120, dbp: 80, tempC: 37, spo2: 98 })).toEqual([]);
  });
});

describe("time", () => {
  it("computes clock offset from the round-trip midpoint", () => {
    const server = new Date(Date.UTC(2026, 9, 25, 12, 0, 0)).toISOString();
    const local = Date.UTC(2026, 9, 25, 11, 0, 0); // tablet is one hour slow
    expect(clockOffsetMs(server, local - 500, local + 500)).toBe(3_600_000);
  });
  it("last-write-wins keeps the existing copy on ties", () => {
    expect(incomingWins("2026-10-25T10:00:00Z", "2026-10-25T10:00:01Z")).toBe(true);
    expect(incomingWins("2026-10-25T10:00:00Z", "2026-10-25T10:00:00Z")).toBe(false);
  });
});

describe("i18n", () => {
  it("has every key in every language, none empty", () => {
    for (const dict of [ht, fr]) {
      for (const key of Object.keys(en)) {
        expect(dict[key as keyof typeof en], key).toBeTruthy();
      }
    }
  });
  it("keeps the same placeholders across languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(ht[key]), `ht ${key}`).toBe(vars(en[key]));
      expect(vars(fr[key]), `fr ${key}`).toBe(vars(en[key]));
    }
  });
  it("interpolates variables", () => {
    expect(translate("ht", "sync.pending", { n: 3 })).toBe("3 poko voye");
  });
  it("an incomplete low set says so instead of 'routine'", () => {
    const t = createTranslator("en");
    const d = describeMews(t, computeMews({ hr: 80 }), DEFAULT_MEWS_CONFIG);
    expect(d.headline).toBe("Not all signs recorded — score may be too low");
  });
  it("describes a high MEWS in Kreyòl", () => {
    const t = createTranslator("ht");
    const r = computeMews({ rr: 32, hr: 80, sbp: 120, tempC: 37, avpu: "A", spo2: 85 });
    const d = describeMews(t, r, DEFAULT_MEWS_CONFIG);
    expect(d.headline).toBe("IJAN: rele doktè a kounye a");
    expect(d.lines.join(" ")).toContain("Respirasyon pou kont li grav");
    expect(d.lines.join(" ")).toContain("SpO₂ anba 90%");
  });
});

describe("schemas", () => {
  it("validates an observation and rejects bad ids", () => {
    const ok = ObservationSchema.safeParse({
      id: crypto.randomUUID(),
      patientId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
      recordedBy: crypto.randomUUID(),
      hr: 80,
    });
    expect(ok.success).toBe(true);
    expect(ObservationSchema.safeParse({ id: "x" }).success).toBe(false);
  });
  it("defaults missing push arrays", () => {
    expect(PushRequestSchema.parse({}).patients).toEqual([]);
  });
});
