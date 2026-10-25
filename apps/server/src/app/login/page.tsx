import { LOCALES, LOCALE_NAMES } from "@swen/core";
import { redirect } from "next/navigation";
import { login, setLanguage } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { isAdmin } from "@/lib/admin";
import { getI18n } from "@/lib/locale";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/");
  const { t, locale } = await getI18n();
  return (
    <main className="login">
      <div className="card">
        <div>
          <h1>{t("dash.title")}</h1>
          <p className="muted small">{t("app.tagline")}</p>
        </div>
        <ActionForm action={login} submitLabel={t("dash.login")} resetOnSuccess={false}>
          <label>
            {t("dash.password")}
            <input type="password" name="password" autoComplete="current-password" required autoFocus />
          </label>
        </ActionForm>
        <form action={setLanguage}>
          <AutoSubmitSelect name="locale" value={locale} label={t("settings.language")} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))} />
        </form>
      </div>
    </main>
  );
}
