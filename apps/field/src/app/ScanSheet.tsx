import { useEffect, useRef, useState, type FormEvent } from "react";
import { scanOnce, scanSupported } from "../lib/scanner";
import { Banner } from "./components";
import { useApp } from "./store";

/**
 * Full-width camera scanner with a typed-code fallback. `onCode` returns an
 * error message to show (and keep scanning), or nothing to close.
 */
export function ScanSheet({ title, onCode, onClose }: { title: string; onCode: (raw: string) => Promise<string | void> | string | void; onClose: () => void }) {
  const { t } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [attempt, setAttempt] = useState(0);
  const camera = scanSupported();

  useEffect(() => {
    if (!camera) return;
    const ctrl = new AbortController();
    let alive = true;
    (async () => {
      try {
        const raw = await scanOnce(videoRef.current!, ctrl.signal);
        if (!alive) return;
        const err = await onCode(raw);
        if (err) {
          setError(err);
          setAttempt((a) => a + 1); // scan again
        }
      } catch {
        /* cancelled or camera refused: the typed fallback stays available */
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    const err = await onCode(typed);
    if (err) setError(err);
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-card">
        <h2>{title}</h2>
        {camera ? (
          <div className="scanner">
            <video ref={videoRef} playsInline muted />
            <p>{t("scan.hint")}</p>
          </div>
        ) : (
          <p className="muted small">{t("inventory.scanUnsupported")}</p>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
        <form onSubmit={submit} className="toolbar">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("scan.typeCode")} autoCapitalize="characters" aria-label={t("scan.typeCode")} />
          <button className="btn btn-primary">{t("common.confirm")}</button>
        </form>
        <button className="btn btn-quiet" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
