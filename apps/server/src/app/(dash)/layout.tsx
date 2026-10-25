import { LOCALES, LOCALE_NAMES } from "@swen/core";
import Link from "next/link";
import { logout, setFacility, setLanguage } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { requireAdmin } from "@/lib/admin";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const { facility, facilities } = await currentFacility();

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          Swen
          <small>{facility?.name ?? "—"}</small>
        </div>
        <nav>
          <Link href="/">{t("dash.overview")}</Link>
          <Link href="/patients">{t("dash.patients")}</Link>
          <Link href="/inventory">{t("dash.inventory")}</Link>
          <Link href="/admin">{t("dash.admin")}</Link>
        </nav>
        <div className="side-bottom">
          {facilities.length > 1 && (
            <form action={setFacility}>
              <AutoSubmitSelect name="facilityId" value={facility?.id ?? ""} label={t("dash.facility")} options={facilities.map((f) => ({ value: f.id, label: f.name }))} />
            </form>
          )}
          <form action={setLanguage}>
            <AutoSubmitSelect name="locale" value={locale} label={t("settings.language")} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))} />
          </form>
          <form action={logout}>
            <button className="btn btn-secondary" type="submit">
              {t("dash.logout")}
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
