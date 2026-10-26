import { ageInYears, DASHBOARD_ACTOR_ID, effectiveObservations, type MessageKey, type MewsLevel } from "@swen/core";
import { notFound } from "next/navigation";
import { MewsBadge, MewsTrend, Section } from "@/components/ui";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";
import { staffNames } from "@/lib/queries";
import { resolveMewsConfig } from "@swen/core";

const fmt = (v: number | null, digits = 0) => (v == null ? "—" : v.toFixed(digits));

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, fmtDateTime } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility || !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const patient = await db().patient.findFirst({ where: { id, facilityId: facility.id } });
  if (!patient) notFound();
  const [observations, escalations, names, equipment, devices] = await Promise.all([
    db().observation.findMany({ where: { patientId: id }, orderBy: { recordedAt: "desc" }, take: 200 }),
    db().escalation.findMany({ where: { patientId: id }, orderBy: { at: "desc" } }),
    staffNames(db(), facility.id),
    db().equipment.findMany({ where: { facilityId: facility.id }, select: { id: true, code: true } }),
    db().device.findMany({ where: { facilityId: facility.id }, select: { id: true, name: true } }),
  ]);
  const eqCode = new Map(equipment.map((e) => [e.id, e.code]));
  const devName = new Map(devices.map((d) => [d.id, d.name]));
  const cfg = resolveMewsConfig(facility.mewsConfig);
  const effective = effectiveObservations(observations);
  const supersededIds = new Set(observations.map((o) => o.supersedesId).filter(Boolean));
  const escByObs = new Map<string, typeof escalations>();
  for (const e of escalations) escByObs.set(e.observationId, [...(escByObs.get(e.observationId) ?? []), e]);
  const who = (by: string) => (by === DASHBOARD_ACTOR_ID ? "Admin" : (names.get(by) ?? "—"));
  const age = ageInYears(patient.birthYear);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {patient.givenName} {patient.familyName}
          </h1>
          <p className="muted">
            {patient.ward}
            {patient.bed ? ` · ${t("patients.bed")} ${patient.bed}` : ""}
            {patient.mrn ? ` · ${patient.mrn}` : ""}
            {age != null ? ` · ${t("patients.age", { n: age })}` : ""} · {t(`patients.sex.${patient.sex}` as MessageKey)}
            {patient.isPregnant ? ` · ${t("patients.pregnant")}` : ""}
            {patient.dischargedAt ? ` · ${t("patients.discharged")} ${fmtDateTime(patient.dischargedAt)}` : ""}
          </p>
        </div>
      </div>

      <Section title={t("vitals.trend")}>
        <MewsTrend
          label={t("vitals.trend")}
          medium={cfg.levels.medium}
          high={cfg.levels.high}
          points={[...effective].reverse().map((o) => ({ t: o.recordedAt.getTime(), v: o.mewsTotal }))}
        />
        {effective.length < 2 && <p className="muted">{effective.length ? "" : t("patients.noVitals")}</p>}
      </Section>

      <Section title={t("vitals.history")}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("dash.when")}</th>
                <th>{t("vitals.score")}</th>
                <th className="num">RR</th>
                <th className="num">HR</th>
                <th className="num">TA</th>
                <th className="num">T °C</th>
                <th className="num">SpO₂</th>
                <th>AVPU</th>
                <th>{t("dash.recordedBy")}</th>
                <th>{t("dash.device")}</th>
                <th>{t("dash.instrument")}</th>
                <th>{t("dash.scanned")}</th>
                <th>{t("escalation.title")}</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => {
                const superseded = supersededIds.has(o.id);
                const esc = escByObs.get(o.id) ?? [];
                return (
                  <tr key={o.id} className={superseded ? "muted" : `row-${o.mewsLevel}`} style={superseded ? { textDecoration: "line-through" } : undefined}>
                    <td>
                      {fmtDateTime(o.recordedAt)}
                      {o.supersedesId && <span className="pill"> {t("vitals.corrected")}</span>}
                    </td>
                    <td>
                      <MewsBadge total={o.mewsTotal} level={o.mewsLevel as MewsLevel} complete={o.mewsComplete} />
                    </td>
                    <td className="num">{fmt(o.rr)}</td>
                    <td className="num">{fmt(o.hr)}</td>
                    <td className="num">
                      {fmt(o.sbp)}/{fmt(o.dbp)}
                    </td>
                    <td className="num">{fmt(o.tempC, 1)}</td>
                    <td className="num">{fmt(o.spo2)}</td>
                    <td>{o.avpu ?? "—"}</td>
                    <td className="muted">{who(o.recordedBy)}</td>
                    <td className="muted small">{o.deviceId ? (devName.get(o.deviceId) ?? "—") : "—"}</td>
                    <td className="small">
                      {[...new Set(Object.values((o.equipment ?? {}) as Record<string, string>))].map((id) => eqCode.get(id) ?? "?").join(", ") || "—"}
                    </td>
                    <td>{o.patientScanned ? <span className="pill pill-ok">✓</span> : <span className="muted small">—</span>}</td>
                    <td className="small">
                      {esc.length
                        ? esc.map((e) => (
                            <div key={e.id}>
                              {t(`escalation.action.${e.action}` as MessageKey)} — {who(e.by)}, {fmtDateTime(e.at)}
                            </div>
                          ))
                        : o.mewsLevel !== "low" && !superseded
                          ? <span className="pill pill-high">{t("dash.unacknowledged")}</span>
                          : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
