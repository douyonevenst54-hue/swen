import { en, type MessageKey } from "./en";
import { fr } from "./fr";
import { ht } from "./ht";

export type { MessageKey };
export const LOCALES = ["ht", "fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ht";

export const LOCALE_NAMES: Record<Locale, string> = { ht: "Kreyòl", fr: "Français", en: "English" };

/** Intl locale tags used for dates and numbers. Kreyòl falls back to French formatting. */
export const INTL_LOCALE: Record<Locale, string> = { ht: "fr-HT", fr: "fr-HT", en: "en-US" };

const DICTS: Record<Locale, Record<MessageKey, string>> = { ht, fr, en };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = DICTS[locale][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function createTranslator(locale: Locale) {
  return (key: MessageKey, vars?: Vars) => translate(locale, key, vars);
}
export type Translator = ReturnType<typeof createTranslator>;

/**
 * "5 min ago" / "in 2 h". Kreyòl has no CLDR data in most browsers (it would
 * fall back to French), so it is written out here.
 */
export function relativeTime(locale: Locale, target: Date | string | number, now: number = Date.now()): string {
  const diffMin = Math.round((new Date(target).getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  const [n, unit] = abs < 60 ? [abs, "min"] : abs < 48 * 60 ? [Math.round(abs / 60), "h"] : [Math.round(abs / 1440), "d"];
  if (locale === "ht") {
    if (abs < 1) return "kounye a";
    const u = unit === "min" ? "min" : unit === "h" ? "è" : "jou";
    return diffMin < 0 ? `sa gen ${n} ${u}` : `nan ${n} ${u}`;
  }
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  const signed = diffMin < 0 ? -n : n;
  return rtf.format(signed, unit === "min" ? "minute" : unit === "h" ? "hour" : "day");
}

const KREYOL_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "jen", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];

/**
 * A calendar date such as an expiry date ("2028-04-28" → "28 avril 2028").
 * Browsers have no Kreyòl month names (they fall back to French), so they are written out here.
 */
export function formatDate(locale: Locale, value: Date | string): string {
  const d = new Date(value);
  if (locale === "ht") return `${d.getUTCDate()} ${KREYOL_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium", timeZone: "UTC" }).format(d);
}

export { en, fr, ht };
