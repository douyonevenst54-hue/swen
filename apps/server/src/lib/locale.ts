import "server-only";
import { cookies } from "next/headers";
import { createTranslator, DEFAULT_LOCALE, formatDate, INTL_LOCALE, isLocale, relativeTime, type Locale } from "@swen/core";

export const LANG_COOKIE = "swen_lang";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  const t = createTranslator(locale);
  const intl = INTL_LOCALE[locale];
  const fmtDateTime = (d: Date | string) =>
    new Intl.DateTimeFormat(intl, { dateStyle: "short", timeStyle: "short", timeZone: "America/Port-au-Prince" }).format(new Date(d));
  const fmtDate = (d: Date | string) => formatDate(locale, d);
  const fmtRelative = (d: Date | string) => relativeTime(locale, d);
  return { locale, t, fmtDateTime, fmtDate, fmtRelative };
}
