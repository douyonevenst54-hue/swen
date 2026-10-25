import { createTranslator, DEFAULT_LOCALE, INTL_LOCALE, relativeTime, resolveMewsConfig, type Locale, type MewsConfig, type Staff, type Translator } from "@swen/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMeta, setMeta, type DeviceRegistration } from "../lib/db";
import { pendingCount } from "../lib/repo";
import type { Session } from "../lib/session";
import { sync, type SyncOutcome } from "../lib/sync";

export const AUTO_LOCK_MS = 5 * 60_000;
const SYNC_EVERY_MS = 2 * 60_000;
const SYNC_AFTER_WRITE_MS = 4_000;

export type Phase = "loading" | "enroll" | "locked" | "unlocked";

export interface SyncState {
  running: boolean;
  pending: number;
  lastSyncAt: string | null;
  last: SyncOutcome | null;
}

interface AppState {
  phase: Phase;
  locale: Locale;
  t: Translator;
  fmtTime: (iso: string) => string;
  fmtDate: (iso: string) => string;
  fmtRelative: (iso: string) => string;
  device: DeviceRegistration | null;
  roster: Staff[];
  session: Session | null;
  mews: MewsConfig;
  syncState: SyncState;
  lockReason: "auto" | "staff_inactive" | null;
  /** Bumps whenever local data changes; screens re-query when it changes. */
  dataVersion: number;
  setLocale: (l: Locale) => void;
  onEnrolled: () => Promise<void>;
  /** Re-read device settings without changing the lock state. */
  refreshMeta: () => Promise<void>;
  onUnlocked: (s: Session) => void;
  lock: (reason?: AppState["lockReason"]) => void;
  /** Call after any local write. */
  changed: () => void;
  syncNow: () => Promise<SyncOutcome | null>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

/** Session is guaranteed on unlocked screens. */
export function useSession(): Session {
  const s = useApp().session;
  if (!s) throw new Error("locked");
  return s;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [device, setDevice] = useState<DeviceRegistration | null>(null);
  const [roster, setRoster] = useState<Staff[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [mews, setMews] = useState<MewsConfig>(resolveMewsConfig(null));
  const [lockReason, setLockReason] = useState<AppState["lockReason"]>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>({ running: false, pending: 0, lastSyncAt: null, last: null });
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const reloadMeta = useCallback(async () => {
    const [d, r, l, m, last, pending] = await Promise.all([
      getMeta("device"),
      getMeta("roster"),
      getMeta("locale"),
      getMeta("mewsConfig"),
      getMeta("lastSyncAt"),
      pendingCount(),
    ]);
    setDevice(d ?? null);
    setRoster(r ?? []);
    if (l) setLocaleState(l);
    setMews(resolveMewsConfig(m));
    setSyncState((s) => ({ ...s, lastSyncAt: last ?? null, pending }));
    return d;
  }, []);

  useEffect(() => {
    void reloadMeta().then((d) => setPhase(d ? "locked" : "enroll"));
  }, [reloadMeta]);

  const lock = useCallback((reason: AppState["lockReason"] = null) => {
    setSession(null);
    setLockReason(reason);
    setPhase((p) => (p === "unlocked" ? "locked" : p));
  }, []);

  const syncNow = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return null;
    setSyncState((st) => ({ ...st, running: true }));
    const outcome = await sync(s);
    await reloadMeta();
    setSyncState((st) => ({ ...st, running: false, last: outcome }));
    setDataVersion((v) => v + 1);
    if (outcome.status === "staff_inactive") lock("staff_inactive");
    return outcome;
  }, [reloadMeta, lock]);

  // Auto-lock after inactivity; clears the data key from memory.
  useEffect(() => {
    if (phase !== "unlocked") return;
    let timer = setTimeout(() => lock("auto"), AUTO_LOCK_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lock("auto"), AUTO_LOCK_MS);
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [phase, lock]);

  // Background sync while unlocked: periodically and when the network comes back.
  useEffect(() => {
    if (phase !== "unlocked") return;
    void syncNow();
    const id = setInterval(() => void syncNow(), SYNC_EVERY_MS);
    const online = () => void syncNow();
    window.addEventListener("online", online);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", online);
    };
  }, [phase, syncNow]);

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useCallback(() => {
    setDataVersion((v) => v + 1);
    void pendingCount().then((pending) => setSyncState((s) => ({ ...s, pending })));
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => void syncNow(), SYNC_AFTER_WRITE_MS);
  }, [syncNow]);

  const value = useMemo<AppState>(() => {
    const t = createTranslator(locale);
    const intl = INTL_LOCALE[locale];
    return {
      phase,
      locale,
      t,
      fmtTime: (iso) => new Intl.DateTimeFormat(intl, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)),
      fmtDate: (iso) => new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso)),
      fmtRelative: (iso) => relativeTime(locale, iso),
      device,
      roster,
      session,
      mews,
      syncState,
      lockReason,
      dataVersion,
      setLocale: (l) => {
        setLocaleState(l);
        document.documentElement.lang = l;
        void setMeta("locale", l);
      },
      refreshMeta: async () => {
        await reloadMeta();
      },
      onEnrolled: async () => {
        await reloadMeta();
        setPhase("locked");
      },
      onUnlocked: (s) => {
        setSession(s);
        setLockReason(null);
        setPhase("unlocked");
        void reloadMeta();
      },
      lock,
      changed,
      syncNow,
    };
  }, [phase, locale, device, roster, session, mews, syncState, lockReason, dataVersion, reloadMeta, lock, changed, syncNow]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
