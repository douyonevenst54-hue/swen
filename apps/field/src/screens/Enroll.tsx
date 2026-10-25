import { LOCALES, LOCALE_NAMES } from "@swen/core";
import { useState, type FormEvent } from "react";
import { Banner, Field } from "../app/components";
import { useApp } from "../app/store";
import { ApiError } from "../lib/api";
import { enroll } from "../lib/session";

export function Enroll() {
  const { t, locale, setLocale, onEnrolled } = useApp();
  const [serverUrl, setServerUrl] = useState(() => (window.location.pathname.startsWith("/app") ? window.location.origin : ""));
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await enroll(serverUrl.trim().replace(/\/+$/, ""), code.trim(), name.trim());
      await onEnrolled();
    } catch (err) {
      if (err instanceof ApiError && err.offline) setError(t("enroll.needsInternet"));
      else if (err instanceof ApiError && err.code === "invalid_code") setError(t("enroll.invalidCode"));
      else setError(t("common.error", { message: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <img src="/app/icon.svg" alt="" width={48} height={48} />
          <div>
            <h1>Swen</h1>
            <p>{t("app.tagline")}</p>
          </div>
        </div>
        <h2>{t("enroll.title")}</h2>
        <p className="muted">{t("enroll.intro")}</p>
        <form onSubmit={submit} className="stack">
          <Field label={t("enroll.serverUrl")}>
            <input type="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} required placeholder="https://swen.example.org" inputMode="url" autoCapitalize="off" />
          </Field>
          <Field label={t("enroll.code")}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="ABCD-2345" autoCapitalize="characters" autoComplete="off" className="code-input" />
          </Field>
          <Field label={t("enroll.deviceName")}>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          {error && <Banner tone="danger">{error}</Banner>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? t("common.loading") : t("enroll.submit")}
          </button>
        </form>
        <div className="lang-row">
          {LOCALES.map((l) => (
            <button key={l} className={l === locale ? "on" : ""} onClick={() => setLocale(l)}>
              {LOCALE_NAMES[l]}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
