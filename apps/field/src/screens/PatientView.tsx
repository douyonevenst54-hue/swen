import { ageInYears, DASHBOARD_ACTOR_ID, effectiveObservations, type MessageKey, type MewsLevel } from "@swen/core";
import { useEffect, useMemo, useState } from "react";
import { Banner, Empty, MewsBadge, MewsPanel, TopBar } from "../app/components";
import { go } from "../app/router";
import { useApp, useSession } from "../app/store";
import type { EscalationRow, ObservationRow } from "../lib/db";
import { escalationsFor, getPatient, observationsFor, scoreFor, setDischarged, type LocalPatient } from "../lib/repo";

const v = (n: number | null | undefined, digits = 0) => (n == null ? "—" : n.toFixed(digits));

export function PatientView({ id }: { id: string }) {
  const { t, fmtTime, fmtRelative, mews, dataVersion, roster, changed } = useApp();
  const session = useSession();
  const [patient, setPatient] = useState<LocalPatient | null | undefined>(undefined);
  const [obs, setObs] = useState<ObservationRow[]>([]);
  const [esc, setEsc] = useState<EscalationRow[]>([]);

  useEffect(() => {
    void Promise.all([getPatient(session, id), observationsFor(id), escalationsFor(id)]).then(([p, o, e]) => {
      setPatient(p);
      setObs(o);
      setEsc(e);
    });
  }, [id, session, dataVersion]);

  const effective = useMemo(() => effectiveObservations(obs), [obs]);
  const superseded = useMemo(() => new Set(obs.map((o) => o.supersedesId).filter(Boolean)), [obs]);
  const latest = effective[0];
  const latestResult = patient && latest ? scoreFor(patient, latest, mews, new Date(latest.recordedAt)) : null;
  const latestAcked = latest ? esc.some((e) => e.observationId === latest.id) : false;
  const who = (by: string) => (by === DASHBOARD_ACTOR_ID ? "Admin" : (roster.find((s) => s.id === by)?.name ?? "—"));

  if (patient === undefined) return <TopBar title="…" backTo="/" />;
  if (patient === null)
    return (
      <>
        <TopBar title={t("patients.title")} backTo="/" />
        <Empty>{t("patients.notFound")}</Empty>
      </>
    );

  const age = ageInYears(patient.birthYear);
  const sub = [patient.ward, patient.bed ? `${t("patients.bed")} ${patient.bed}` : null, age != null ? t("patients.age", { n: age }) : null, t(`patients.sex.${patient.sex}` as MessageKey), patient.isPregnant ? t("patients.pregnant") : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <TopBar
        title={`${patient.givenName} ${patient.familyName}`}
        sub={sub}
        backTo="/"
        actions={
          <button className="btn btn-quiet" onClick={() => go(`/patient/${id}/edit`)}>
            {t("common.edit")}
          </button>
        }
      />
      <main className="content">
        {patient.dischargedAt && <Banner tone="info">{t("patients.discharged")} · {fmtTime(patient.dischargedAt)}</Banner>}

        {latestResult && latest ? (
          <>
            <MewsPanel result={latestResult} cfg={mews} />
            <p className="muted small pad-x">
              {fmtRelative(latest.recordedAt)} · {t("vitals.by", { name: who(latest.recordedBy) })}
            </p>
            {latestResult.level !== "low" && !latestAcked && (
              <Banner tone="danger" action={<button className="btn btn-danger" onClick={() => go(`/escalate/${latest.id}`)}>{t("escalation.record")}</button>}>
                {t("escalation.pending")}
              </Banner>
            )}
          </>
        ) : (
          <Banner tone="warn">{t("patients.noVitals")}</Banner>
        )}

        <div className="action-row">
          <button className="btn btn-primary btn-lg" onClick={() => go(`/patient/${id}/vitals`)}>
            {t("vitals.record")}
          </button>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              await setDischarged(session, id, !patient.dischargedAt);
              changed();
            }}
          >
            {patient.dischargedAt ? t("patients.readmit") : t("patients.discharge")}
          </button>
        </div>

        {effective.length >= 2 && (
          <section className="panel">
            <h2>{t("vitals.trend")}</h2>
            <Trend points={[...effective].reverse().map((o) => ({ t: Date.parse(o.recordedAt), v: o.mewsTotal ?? 0, level: (o.mewsLevel ?? "low") as MewsLevel }))} medium={mews.levels.medium} high={mews.levels.high} />
          </section>
        )}

        {patient.notes && (
          <section className="panel">
            <h2>{t("patients.notes")}</h2>
            <p className="prewrap">{patient.notes}</p>
          </section>
        )}

        <section className="panel">
          <h2>{t("vitals.history")}</h2>
          {obs.length === 0 ? (
            <p className="muted">{t("patients.noVitals")}</p>
          ) : (
            <ul className="obs-list">
              {obs.map((o) => {
                const isOld = superseded.has(o.id);
                const actions = esc.filter((e) => e.observationId === o.id);
                return (
                  <li key={o.id} className={isOld ? "superseded" : ""}>
                    <div className="obs-head">
                      <MewsBadge total={o.mewsTotal} level={o.mewsLevel as MewsLevel} />
                      <span>
                        <strong>{fmtTime(o.recordedAt)}</strong>
                        <small>
                          {t("vitals.by", { name: who(o.recordedBy) })}
                          {o.supersedesId ? ` · ${t("vitals.corrected")}` : ""}
                          {o.dirty === 1 ? " · ↻" : ""}
                        </small>
                      </span>
                      {!isOld && (
                        <button className="btn btn-quiet small" onClick={() => go(`/patient/${id}/vitals?correct=${o.id}`)}>
                          {t("vitals.correct")}
                        </button>
                      )}
                    </div>
                    <dl className="vitals-grid">
                      <div><dt>{t("vitals.rr")}</dt><dd>{v(o.rr)}</dd></div>
                      <div><dt>{t("vitals.hr")}</dt><dd>{v(o.hr)}{o.sources?.hr === "ble" ? " ᛒ" : ""}</dd></div>
                      <div><dt>{t("vitals.bp.unit")}</dt><dd>{v(o.sbp)}/{v(o.dbp)}</dd></div>
                      <div><dt>{t("vitals.tempC")}</dt><dd>{v(o.tempC, 1)}</dd></div>
                      <div><dt>SpO₂</dt><dd>{v(o.spo2)}</dd></div>
                      <div><dt>AVPU</dt><dd>{o.avpu ?? "—"}</dd></div>
                    </dl>
                    {o.note && <p className="small prewrap">{o.note}</p>}
                    {actions.map((a) => (
                      <p key={a.id} className="small esc-line">
                        ✓ {t(`escalation.action.${a.action}` as MessageKey)} — {who(a.by)}, {fmtTime(a.at)}
                        {a.note ? ` — ${a.note}` : ""}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function Trend({ points, medium, high }: { points: { t: number; v: number; level: MewsLevel }[]; medium: number; high: number }) {
  const W = 600;
  const H = 140;
  const pad = 18;
  const maxV = Math.max(high + 2, ...points.map((p) => p.v));
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (val: number) => H - pad - (val / maxV) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="MEWS">
      <rect x={pad} y={y(maxV)} width={W - 2 * pad} height={y(high - 0.5) - y(maxV)} className="band-high" />
      <rect x={pad} y={y(high - 0.5)} width={W - 2 * pad} height={y(medium - 0.5) - y(high - 0.5)} className="band-medium" />
      <polyline points={points.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")} className="trend-line" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.v)} r={5} className={`trend-dot dot-${p.level}`} />
      ))}
    </svg>
  );
}
