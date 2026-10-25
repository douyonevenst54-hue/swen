import { ageInYears } from "@swen/core";
import Link from "next/link";
import { MewsBadge, Section } from "@/components/ui";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";
import { wardBoard } from "@/lib/queries";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ ward?: string }> }) {
  const { t, fmtRelative } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility) return null;
  const { ward } = await searchParams;
  const { rows } = await wardBoard(db(), facility.id);
  const wards = [...new Set(rows.map((r) => r.patient.ward))].sort();
  const shown = ward ? rows.filter((r) => r.patient.ward === ward) : rows;

  return (
    <>
      <div className="page-head">
        <h1>{t("dash.patients")}</h1>
        <a className="btn btn-secondary" href="/api/export/observations">
          {t("dash.export")}
        </a>
      </div>
      <Section
        title={ward ?? t("patients.allWards")}
        actions={
          <form className="inline">
            <select name="ward" defaultValue={ward ?? ""} aria-label={t("patients.ward")}>
              <option value="">{t("patients.allWards")}</option>
              {wards.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary" type="submit">
              {t("common.search")}
            </button>
          </form>
        }
      >
        {shown.length === 0 ? (
          <p className="muted">{t("patients.empty")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("vitals.score")}</th>
                  <th>{t("dash.name")}</th>
                  <th>{t("patients.ward")}</th>
                  <th>{t("patients.bed")}</th>
                  <th className="num">{t("patients.birthYear")}</th>
                  <th>{t("dash.latest")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.patient.id} className={r.latest ? `row-${r.latest.mewsLevel}` : ""}>
                    <td>{r.latest ? <MewsBadge total={r.latest.mewsTotal} level={r.latest.mewsLevel} complete={r.latest.mewsComplete} /> : "—"}</td>
                    <td>
                      <Link href={`/patients/${r.patient.id}`}>
                        {r.patient.givenName} {r.patient.familyName}
                      </Link>
                      {r.patient.isPregnant && <span className="pill"> {t("patients.pregnant")}</span>}
                    </td>
                    <td>{r.patient.ward}</td>
                    <td>{r.patient.bed ?? "—"}</td>
                    <td className="num">{r.patient.birthYear ? t("patients.age", { n: ageInYears(r.patient.birthYear)! }) : "—"}</td>
                    <td>
                      {r.latest ? fmtRelative(r.latest.recordedAt) : <span className="muted">{t("patients.noVitals")}</span>}
                      {(r.minutesOverdue ?? 0) > 0 && <span className="pill pill-medium"> {t("patients.overdue", { time: t("common.minutes", { n: r.minutesOverdue! }) })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
