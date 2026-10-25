import { LOCALES, LOCALE_NAMES, type MessageKey } from "@swen/core";
import { useEffect, useState } from "react";
import { Banner, BottomNav, TopBar } from "../app/components";
import { useApp, useSession } from "../app/store";
import { api } from "../lib/api";
import { getMeta, localDb, setMeta, type RejectedRow } from "../lib/db";
import { APP_VERSION, resetDevice } from "../lib/session";

export function Settings({ updateReady, onUpdate }: { updateReady: boolean; onUpdate: () => void }) {
  const { t, locale, setLocale, device, syncState, syncNow, fmtRelative, mews, dataVersion } = useApp();
  const session = useSession();
  const [rejected, setRejected] = useState<RejectedRow[]>([]);

  useEffect(() => {
    void localDb().rejected.toArray().then(setRejected);
  }, [dataVersion]);

  const last = syncState.last;
  const status =
    last?.status === "offline"
      ? t("sync.offline")
      : last?.status === "device_revoked"
        ? t("sync.revoked")
        : last?.status === "session_expired"
          ? t("sync.sessionExpired")
          : last && last.status !== "ok"
            ? t("sync.failed", { message: last.status === "error" ? last.message : last.status })
            : null;

  return (
    <>
      <TopBar title={t("settings.title")} />
      <main className="content narrow">
        {updateReady && (
          <Banner tone="info" action={<button className="btn btn-primary" onClick={onUpdate}>{t("settings.update")}</button>}>
            {t("settings.updateReady")}
          </Banner>
        )}

        <section className="panel">
          <h2>{t("settings.language")}</h2>
          <div className="chips">
            {LOCALES.map((l) => (
              <button key={l} className={l === locale ? "on" : ""} onClick={() => setLocale(l)}>
                {LOCALE_NAMES[l]}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{t("sync.now")}</h2>
          <p>
            {syncState.pending ? t("sync.pending", { n: syncState.pending }) : t("sync.synced")}
            <br />
            <span className="muted small">{syncState.lastSyncAt ? t("sync.last", { time: fmtRelative(syncState.lastSyncAt) }) : t("sync.never")}</span>
          </p>
          {status && <Banner tone="warn">{status}</Banner>}
          {last?.status === "ok" && last.waiting > 0 && <Banner tone="info">{t("sync.waiting", { n: last.waiting })}</Banner>}
          <button className="btn btn-primary" disabled={syncState.running} onClick={() => void syncNow()}>
            {syncState.running ? t("sync.syncing") : t("sync.now")}
          </button>
          {rejected.length > 0 && (
            <>
              <Banner tone="danger">{t("sync.rejected", { n: rejected.length })}</Banner>
              <ul className="small muted">
                {rejected.map((r) => (
                  <li key={r.id}>
                    {r.table} · {r.reason} · {fmtRelative(r.at)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel">
          <dl className="kv">
            <dt>{t("settings.staff")}</dt>
            <dd>
              {session.staff.name} ({t(`role.${session.staff.role}` as MessageKey)})
            </dd>
            <dt>{t("settings.facility")}</dt>
            <dd>{device?.facility.name}</dd>
            <dt>{t("settings.device")}</dt>
            <dd>{device?.deviceName}</dd>
            <dt>{t("settings.server")}</dt>
            <dd className="break">
              <ServerAddress />
            </dd>
            <dt>{t("settings.mewsConfig")}</dt>
            <dd>
              {mews.name} · {t("vitals.level.medium")} ≥ {mews.levels.medium} · {t("vitals.level.high")} ≥ {mews.levels.high}
            </dd>
            <dt>{t("settings.version")}</dt>
            <dd>{APP_VERSION}</dd>
          </dl>
        </section>

        <section className="panel">
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm(t("settings.resetConfirm"))) return;
              await resetDevice();
              window.location.reload();
            }}
          >
            {t("settings.reset")}
          </button>
        </section>
      </main>
      <BottomNav current="settings" />
    </>
  );
}

/** Change the server address (e.g. after moving to a new host). The device keeps its identity. */
function ServerAddress() {
  const { t, device, refreshMeta } = useApp();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(device?.serverUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!editing)
    return (
      <>
        {device?.serverUrl}{" "}
        <button className="btn btn-quiet small" onClick={() => setEditing(true)}>
          {t("settings.changeServer")}
        </button>
      </>
    );
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const clean = url.trim().replace(/\/+$/, "");
        try {
          await api.health(clean);
        } catch {
          setError(t("enroll.needsInternet"));
          return;
        }
        const current = await getMeta("device");
        if (current) await setMeta("device", { ...current, serverUrl: clean });
        await refreshMeta();
        setEditing(false);
        setError(null);
      }}
    >
      <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required autoCapitalize="off" />
      {error && <Banner tone="warn">{error}</Banner>}
      <button className="btn btn-primary">{t("common.save")}</button>
    </form>
  );
}
