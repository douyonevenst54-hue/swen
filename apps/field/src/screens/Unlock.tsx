import { LOCALES, LOCALE_NAMES, parseScannedCode, type MessageKey } from "@swen/core";
import { ScanSheet } from "../app/ScanSheet";
import { useEffect, useState } from "react";
import { Banner } from "../app/components";
import { useApp } from "../app/store";
import { refreshRoster, unlock, UnlockError } from "../lib/session";

const PIN_MAX = 8;

export function Unlock() {
  const { t, roster, device, locale, setLocale, onUnlocked, lockReason, onEnrolled } = useApp();
  const active = roster.filter((s) => s.active);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Keep the staff list current when there is a connection.
  useEffect(() => {
    void refreshRoster().then((r) => r && onEnrolled());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active.length === 1 && !staffId) setStaffId(active[0]!.id);
  }, [active, staffId]);

  async function submit(value = pin) {
    if (!staffId || value.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await unlock(staffId, value));
    } catch (e) {
      setPin("");
      if (e instanceof UnlockError) {
        if (e.code === "locked_out") setError(t("unlock.lockedOut", { minutes: Math.max(1, Math.ceil(((e.retryAt ?? Date.now()) - Date.now()) / 60_000)) }));
        else if (e.code === "first_time_online") setError(t("unlock.firstTimeOnline"));
        else if (e.code === "device_revoked") setError(t("sync.revoked"));
        else if (e.code === "staff_inactive") setError(t("unlock.staffInactive"));
        else setError(t("unlock.wrongPin"));
      } else setError(t("common.error", { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  const press = (d: string) => {
    if (busy) return;
    if (d === "del") return setPin((p) => p.slice(0, -1));
    if (d === "ok") return void submit();
    setPin((p) => (p.length < PIN_MAX ? p + d : p));
  };

  return (
    <main className="gate">
      <div className="gate-card unlock">
        <div className="gate-brand">
          <img src="/app/icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>{device?.facility.name ?? "Swen"}</h1>
            <p>{device?.deviceName}</p>
          </div>
        </div>
        {lockReason === "auto" && <Banner tone="info">{t("unlock.autoLocked")}</Banner>}
        <div className="row-between">
          <h2>{t("unlock.title")}</h2>
          {active.length > 0 && (
            <button className="btn btn-quiet small" onClick={() => setScanning(true)}>
              {t("scan.staffBadge")}
            </button>
          )}
        </div>
        {scanning && (
          <ScanSheet
            title={t("scan.staffBadge")}
            onClose={() => setScanning(false)}
            onCode={(raw) => {
              const code = parseScannedCode(raw);
              if (code.kind !== "staff") return t("scan.wrongKind");
              if (!active.some((s) => s.id === code.value)) return t("scan.unknown", { code: code.value.slice(0, 8) });
              setStaffId(code.value);
              setPin("");
              setError(null);
              setScanning(false);
            }}
          />
        )}
        {active.length === 0 ? (
          <Banner tone="warn">{t("unlock.noStaff")}</Banner>
        ) : (
          <div className="staff-grid" role="radiogroup" aria-label={t("unlock.title")}>
            {active.map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={staffId === s.id}
                className={staffId === s.id ? "on" : ""}
                onClick={() => {
                  setStaffId(s.id);
                  setPin("");
                  setError(null);
                }}
              >
                <span className="avatar" aria-hidden>
                  {s.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <small>{t(`role.${s.role}` as MessageKey)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {staffId && (
          <div className="pin-area">
            <div className="pin-dots" aria-label={t("unlock.pin")}>
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span key={i} className={i < pin.length ? "on" : ""} />
              ))}
            </div>
            {/* A real input keeps hardware keyboards and screen readers working. */}
            <input
              className="sr-only"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t("unlock.pin")}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
            {error && <Banner tone="danger">{error}</Banner>}
            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"].map((k) => (
                <button key={k} onClick={() => press(k)} disabled={busy || (k === "ok" && pin.length < 4)} className={k === "ok" ? "key-ok" : k === "del" ? "key-del" : ""} aria-label={k === "del" ? "⌫" : k === "ok" ? t("unlock.submit") : k}>
                  {k === "del" ? "⌫" : k === "ok" ? (busy ? "…" : t("unlock.submit")) : k}
                </button>
              ))}
            </div>
          </div>
        )}
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
