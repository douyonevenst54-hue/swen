/** Turn MEWS results and stock alerts into translated, human-readable lines. */
import type { Translator } from "./i18n";
import type { MewsConfig, MewsResult, ScoredParam } from "./mews";
import type { StockAlert } from "./inventory";
import type { MessageKey } from "./i18n/en";

const PARAM_KEY: Record<ScoredParam, MessageKey> = {
  rr: "vitals.rr",
  hr: "vitals.hr",
  sbp: "vitals.sbp",
  tempC: "vitals.tempC",
  avpu: "vitals.avpu",
};

export function paramLabel(t: Translator, p: ScoredParam): string {
  return t(PARAM_KEY[p]);
}

export function describeMews(t: Translator, r: MewsResult, cfg: MewsConfig): { headline: string; lines: string[] } {
  // An incomplete set must not look reassuring: missing signs score 0.
  const headline = r.level === "low" && !r.complete ? t("vitals.flag.incomplete") : t(`vitals.level.${r.level}` as MessageKey);
  const lines: string[] = [];
  for (const reason of r.reasons) {
    if (reason === "total_high") lines.push(t("vitals.reason.total_high", { total: cfg.levels.high }));
    else if (reason === "total_medium") lines.push(t("vitals.reason.total_medium", { total: cfg.levels.medium }));
    else if (reason.startsWith("single_")) lines.push(t("vitals.reason.single", { param: paramLabel(t, reason.slice(7) as ScoredParam) }));
  }
  for (const flag of r.flags) {
    if (flag === "spo2_low") lines.push(t("vitals.flag.spo2_low", { value: cfg.flags.spo2Below }));
    else if (flag === "incomplete") lines.push(t("vitals.incomplete", { missing: r.missing.map((m) => paramLabel(t, m)).join(", ") }));
    else lines.push(t(`vitals.flag.${flag}` as MessageKey));
  }
  if (r.level !== "low" || r.recheckMinutes) lines.push(t("vitals.recheck", { minutes: r.recheckMinutes }));
  return { headline, lines };
}

export function describeStockAlert(t: Translator, a: StockAlert, formatDate: (iso: string) => string = (d) => d): string {
  switch (a.kind) {
    case "out_of_stock":
      return t("inventory.alert.out_of_stock");
    case "low_stock":
      return t("inventory.alert.low_stock", { total: a.total, min: a.minStock });
    case "expired":
      return t("inventory.alert.expired", { lot: a.lot ?? "—", quantity: a.quantity });
    case "expiring_soon":
      return t("inventory.alert.expiring_soon", { days: a.daysLeft, lot: a.lot ?? "—", date: formatDate(a.expiryDate) });
    case "negative_balance":
      return t("inventory.alert.negative_balance");
  }
}
