import {
  ageInYears,
  compareQueue,
  localDay,
  minutesPastTarget,
  minutesSince,
  parseScannedCode,
  type Match,
  type MessageKey,
  type TriageColor,
  type VisitKind,
  type VisitStatus,
} from "@swen/core";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BottomNav, Empty, Field, Segmented, TopBar } from "../app/components";
import { go } from "../app/router";
import { ScanSheet } from "../app/ScanSheet";
import { useApp, useSession } from "../app/store";
import type { VisitRow } from "../lib/db";
import { checkIn, getPatient, lastVisitByPatient, listPatients, openVisitFor, searchPatients, updateVisit, visitsOn, type LocalPatient } from "../lib/repo";

const SERVICE_KEY = "swen.service";

function readLastService(fallback: string): string {
  try {
    return localStorage.getItem(SERVICE_KEY) || fallback;
  } catch {
    return fallback;
  }
}

/** Front desk and waiting queue: find or register the patient, check them in, move them along. */
export function Queue({ checkInId }: { checkInId?: string | null }) {
  const { t, dataVersion, device, changed, fmtRelative } = useApp();
  const session = useSession();
  const [query, setQuery] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [results, setResults] = useState<Match<LocalPatient>[] | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [people, setPeople] = useState<Map<string, LocalPatient>>(new Map());
  const [lastVisits, setLastVisits] = useState<Map<string, string>>(new Map());
  const [checkInFor, setCheckInFor] = useState<LocalPatient | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const today = localDay(new Date());

  // Today's queue.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [v, all, last] = await Promise.all([visitsOn(today), listPatients(session, { includeDischarged: true }), lastVisitByPatient()]);
      if (!alive) return;
      setVisits(v);
      setPeople(new Map(all.map((p) => [p.id, p])));
      setLastVisits(last);
    })();
    return () => {
      alive = false;
    };
  }, [session, dataVersion, today]);

  // Search as they type.
  useEffect(() => {
    let alive = true;
    const year = /^\d{4}$/.test(birthYear) ? Number(birthYear) : null;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      void searchPatients(session, { text: query, birthYear: year }).then((r) => alive && setResults(r));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, birthYear, session, dataVersion]);

  // Arriving from registration: open the check-in sheet for the new patient.
  useEffect(() => {
    if (!checkInId) return;
    void getPatient(session, checkInId).then((p) => p && setCheckInFor(p));
  }, [checkInId, session]);

  const inQueue = useMemo(() => new Set(visits.filter((v) => ["waiting", "triaged", "consulting"].includes(v.status)).map((v) => v.patientId)), [visits]);
  const groups = useMemo(() => {
    const by = (s: VisitStatus) => visits.filter((v) => v.status === s).sort(compareQueue);
    return { waiting: by("waiting"), triaged: by("triaged"), consulting: by("consulting"), done: visits.filter((v) => v.status === "done" || v.status === "left") };
  }, [visits]);

  const move = async (v: VisitRow, status: VisitStatus) => {
    await updateVisit(session, v.id, { status });
    changed();
  };

  const registerHref = `/register?name=${encodeURIComponent(query.trim())}${/^\d{4}$/.test(birthYear) ? `&year=${birthYear}` : ""}`;

  return (
    <>
      <TopBar title={t("queue.title")} sub={device?.facility.name} />
      <main className="content">
        <section className="panel desk">
          <div className="desk-search">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("common.search")} autoComplete="off" />
            <input
              className="year-input"
              inputMode="numeric"
              maxLength={4}
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))}
              placeholder={t("search.yearShort")}
              aria-label={t("search.birthYear")}
            />
            <button className="btn btn-quiet" onClick={() => setScanning(true)}>
              {t("scan.card")}
            </button>
          </div>
          {results === null ? (
            <p className="muted small">{t("search.hint")}</p>
          ) : (
            <>
              {results.length === 0 && <p className="muted">{t("search.noResults")}</p>}
              <ul className="result-list">
                {results.map(({ person: p }) => (
                  <li key={p.id}>
                    <a href={`#/patient/${p.id}`} className="result-main">
                      <strong>
                        {p.givenName} {p.familyName}
                        {p.otherNames ? <span className="muted"> ({p.otherNames})</span> : null}
                      </strong>
                      <small>
                        {[
                          t(`patients.sex.${p.sex}` as MessageKey),
                          ageInYears(p.birthYear) != null ? t("patients.age", { n: ageInYears(p.birthYear)! }) : null,
                          p.commune,
                          p.motherName ? t("patients.mother", { name: p.motherName }) : null,
                          p.number,
                          lastVisits.get(p.id) ? t("patients.lastVisit", { time: fmtRelative(lastVisits.get(p.id)!) }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </a>
                    {inQueue.has(p.id) ? (
                      <span className="tag">{t("queue.inQueue")}</span>
                    ) : (
                      <button className="btn btn-primary small" onClick={() => setCheckInFor(p)}>
                        {t("checkin.title")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button className="btn btn-quiet" onClick={() => go(registerHref)}>
                + {t("search.register")}
              </button>
            </>
          )}
        </section>

        {visits.length === 0 ? (
          <Empty action={<button className="btn btn-primary" onClick={() => go(registerHref)}>{t("search.register")}</button>}>{t("queue.empty")}</Empty>
        ) : (
          <>
            <QueueGroup title={t("queue.waiting")} rows={groups.waiting} people={people}>
              {(v) => (
                <>
                  <button className="btn btn-primary small" onClick={() => go(`/visit/${v.id}/triage`)}>
                    {t("queue.triage")}
                  </button>
                  <button className="btn btn-quiet small" onClick={() => void move(v, "consulting")}>
                    {t("queue.callIn")}
                  </button>
                  <button className="btn btn-quiet small" onClick={() => void move(v, "left")}>
                    {t("queue.left")}
                  </button>
                </>
              )}
            </QueueGroup>
            <QueueGroup title={t("queue.triaged")} rows={groups.triaged} people={people}>
              {(v) => (
                <>
                  <button className="btn btn-primary small" onClick={() => void move(v, "consulting")}>
                    {t("queue.callIn")}
                  </button>
                  <button className="btn btn-quiet small" onClick={() => void move(v, "left")}>
                    {t("queue.left")}
                  </button>
                </>
              )}
            </QueueGroup>
            <QueueGroup title={t("queue.consulting")} rows={groups.consulting} people={people}>
              {(v) => (
                <button className="btn btn-primary small" onClick={() => void move(v, "done")}>
                  {t("queue.finish")}
                </button>
              )}
            </QueueGroup>
            {groups.done.length > 0 && (
              <section className="queue-group">
                <button className="btn btn-quiet" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                  {t("queue.done")} ({groups.done.length})
                </button>
                {showDone && <QueueGroup title="" rows={groups.done} people={people} />}
              </section>
            )}
          </>
        )}
      </main>

      {checkInFor && (
        <CheckInSheet
          patient={checkInFor}
          onClose={() => {
            setCheckInFor(null);
            if (checkInId) go("/queue");
          }}
          onDone={() => {
            setCheckInFor(null);
            setQuery("");
            setBirthYear("");
            changed();
            if (checkInId) go("/queue");
          }}
        />
      )}
      {scanning && (
        <ScanSheet
          title={t("scan.card")}
          onClose={() => setScanning(false)}
          onCode={async (raw) => {
            const code = parseScannedCode(raw);
            if (code.kind !== "patient") return t("scan.wrongKind");
            const p = await getPatient(session, code.value);
            if (!p) return t("scan.unknown", { code: code.value.slice(0, 8) });
            setScanning(false);
            if (await openVisitFor(p.id)) go(`/patient/${p.id}`);
            else setCheckInFor(p);
          }}
        />
      )}
      <BottomNav current="queue" />
    </>
  );
}

function QueueGroup({ title, rows, people, children }: { title: string; rows: VisitRow[]; people: Map<string, LocalPatient>; children?: (v: VisitRow) => ReactNode }) {
  const { t } = useApp();
  if (!rows.length) return null;
  const now = Date.now();
  return (
    <section className="queue-group">
      {title && (
        <h2>
          {title} <span className="muted">({rows.length})</span>
        </h2>
      )}
      <ul className="queue-list">
        {rows.map((v) => {
          const p = people.get(v.patientId);
          const waited = minutesSince(v.arrivedAt, now);
          const late = minutesPastTarget(v, now);
          return (
            <li key={v.id} className={`queue-row ${v.triageColor ? `tri-${v.triageColor}` : ""} ${v.kind === "emergency" ? "is-emergency" : ""}`}>
              <a href={`#/patient/${v.patientId}`} className="queue-main">
                <span className={`tri-chip ${v.triageColor ? `tri-${v.triageColor}` : "tri-none"}`}>{v.triageColor ? t(`triage.short.${v.triageColor}` as MessageKey) : "·"}</span>
                <span>
                  <strong>{p ? `${p.givenName} ${p.familyName}` : "…"}</strong>
                  <small>
                    {[
                      v.kind === "emergency" ? t("visit.kind.emergency") : v.service,
                      p && ageInYears(p.birthYear) != null ? t("patients.age", { n: ageInYears(p.birthYear)! }) : null,
                      v.chiefComplaint,
                      waited != null && (v.status === "waiting" || v.status === "triaged") ? t("queue.waited", { time: t("common.minutes", { n: waited }) }) : null,
                      v.status === "left" ? t("visit.status.left") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                {late != null && <span className="tag tag-danger">{t("queue.late", { time: t("common.minutes", { n: late }) })}</span>}
                {v.dirty === 1 && <span className="tag">↻</span>}
              </a>
              {children && <div className="queue-actions">{children(v)}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CheckInSheet({ patient, onClose, onDone }: { patient: LocalPatient; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const session = useSession();
  const [kind, setKind] = useState<VisitKind>("outpatient");
  const [service, setService] = useState(() => readLastService(t("visit.defaultService")));
  const [complaint, setComplaint] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!service.trim()) return;
    setBusy(true);
    try {
      const v = await checkIn(session, patient.id, { kind, service, chiefComplaint: complaint });
      try {
        localStorage.setItem(SERVICE_KEY, service.trim());
      } catch {
        /* private mode */
      }
      onDone();
      // Emergencies go straight to triage.
      if (kind === "emergency") go(`/visit/${v.id}/triage`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={t("checkin.title")}>
      <form className="sheet-card" onSubmit={submit}>
        <h2>
          {t("checkin.title")}: {patient.givenName} {patient.familyName}
        </h2>
        {patient.number && <p className="muted small">{patient.number}</p>}
        <Field label={t("visit.kind")}>
          <Segmented
            name={t("visit.kind")}
            value={kind}
            onChange={setKind}
            options={(["outpatient", "emergency"] as const).map((k) => ({ value: k, label: t(`visit.kind.${k}`) }))}
          />
        </Field>
        <Field label={t("visit.service")}>
          <input value={service} onChange={(e) => setService(e.target.value)} required maxLength={80} />
        </Field>
        <Field label={t("visit.complaint")} hint={t("common.optional")}>
          <input value={complaint} onChange={(e) => setComplaint(e.target.value)} maxLength={300} />
        </Field>
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {t("checkin.submit")}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </form>
    </div>
  );
}

export const TRIAGE_COLORS: TriageColor[] = ["red", "orange", "yellow", "green"];
