import { describeMews, type MewsConfig, type MewsLevel, type MewsResult } from "@swen/core";
import type { ReactNode } from "react";
import { back, go } from "./router";
import { useApp } from "./store";

export function SyncPill() {
  const { t, syncState, fmtRelative, syncNow, lock } = useApp();
  const { running, pending, last, lastSyncAt } = syncState;
  let tone = "ok";
  let text = t("sync.synced");
  if (last?.status === "session_expired" && !running) {
    // The fix is to unlock again while online; tapping the pill does that.
    return (
      <button className="sync-pill sync-warn" onClick={() => lock()} title={t("sync.sessionExpired")}>
        <span className="dot" aria-hidden />
        {pending ? t("sync.pending", { n: pending }) : t("nav.lock")}
      </button>
    );
  }
  if (last?.status === "device_revoked") {
    tone = "danger";
    text = t("sync.revoked");
  } else if (running) {
    tone = "busy";
    text = t("sync.syncing");
  } else if (last?.status === "offline") {
    tone = "warn";
    text = pending ? t("sync.pending", { n: pending }) : t("sync.offline");
  } else if (last && last.status !== "ok") {
    tone = "warn";
    text = pending ? t("sync.pending", { n: pending }) : t("sync.failed", { message: last.status });
  } else if (pending > 0) {
    tone = "warn";
    text = t("sync.pending", { n: pending });
  }
  return (
    <button className={`sync-pill sync-${tone}`} onClick={() => void syncNow()} title={lastSyncAt ? t("sync.last", { time: fmtRelative(lastSyncAt) }) : t("sync.never")}>
      <span className="dot" aria-hidden />
      {text}
    </button>
  );
}

export function TopBar({ title, sub, backTo, actions }: { title: string; sub?: string; backTo?: string; actions?: ReactNode }) {
  const { t } = useApp();
  return (
    <header className="topbar">
      {backTo !== undefined && (
        <button className="icon-btn" aria-label={t("common.back")} onClick={() => back(backTo)}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className="topbar-title">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="topbar-actions">
        {actions}
        <SyncPill />
      </div>
    </header>
  );
}

export function BottomNav({ current }: { current: "ward" | "inventory" | "settings" }) {
  const { t, lock } = useApp();
  const item = (key: typeof current, href: string, label: string, icon: ReactNode) => (
    <a href={`#${href}`} className={current === key ? "active" : ""} aria-current={current === key ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </a>
  );
  const svg = (d: string) => (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <nav className="bottomnav">
      {item("ward", "/", t("nav.ward"), svg("M3 12h4l3-7 4 14 3-7h4"))}
      {item("inventory", "/inventory", t("nav.inventory"), svg("M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"))}
      {item("settings", "/settings", t("nav.settings"), svg("M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8 3 11l2 1v0l-2 1 1 3 2-.5L7.5 16 7 18l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z"))}
      <button onClick={() => lock()}>
        {svg("M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z")}
        <span>{t("nav.lock")}</span>
      </button>
    </nav>
  );
}

export function MewsBadge({ total, level, size = "md" }: { total: number | null | undefined; level: MewsLevel | null | undefined; size?: "md" | "lg" }) {
  if (total == null || !level) return <span className={`badge badge-none badge-${size}`}>—</span>;
  return <span className={`badge badge-${level} badge-${size}`}>{total}</span>;
}

/** The live score panel: the one loud element in the interface. */
export function MewsPanel({ result, cfg, compact = false }: { result: MewsResult | null; cfg: MewsConfig; compact?: boolean }) {
  const { t } = useApp();
  if (!result) return null;
  const { headline, lines } = describeMews(t, result, cfg);
  return (
    <section className={`mews-panel mews-${result.level} ${result.level === "low" && !result.complete ? "mews-incomplete" : ""} ${compact ? "compact" : ""}`} aria-live="polite">
      <div className="mews-score">
        <span className="mews-label">{t("vitals.score")}</span>
        <span className="mews-number">{result.total}</span>
      </div>
      <div className="mews-text">
        <strong>{headline}</strong>
        {!compact && (
          <ul>
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function Banner({ tone, children, action }: { tone: "info" | "warn" | "danger" | "ok"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Fab({ href, label }: { href: string; label: string }) {
  return (
    <button className="fab" onClick={() => go(href)}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className={`field ${error ? "has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, name }: { value: T | null; options: { value: T; label: string; sub?: string }[]; onChange: (v: T) => void; name: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          <strong>{o.label}</strong>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}
