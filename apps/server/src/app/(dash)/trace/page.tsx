import { DASHBOARD_ACTOR_ID, type MessageKey, type MewsLevel } from "@swen/core";
import Link from "next/link";
import { MewsBadge, Section } from "@/components/ui";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";

const UUID = /^[0-9a-f-]{36}$/i;
const fmt = (v: number | null, digits = 0) => (v == null ? "—" : v.toFixed(digits));

/**
 * Traceability: every reading taken with one instrument, by one staff member,
 * or on one tablet. Used when a reading looks wrong, an instrument is found
 * faulty, or an incident is reviewed.
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ equipment?: string; staff?: string; device?: string }> }) {
  const { t, fmtDateTime, fmtDate } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility) return null;
  const sp = await searchParams;
  const equipmentId = sp.equipment && UUID.test(sp.equipment) ? sp.equipment : "";
  const staffId = sp.staff && UUID.test(sp.staff) ? sp.staff : "";
  const deviceId = sp.device && UUID.test(sp.device) ? sp.device : "";

  const [equipment, staff, devices] = await Promise.all([
    db().equipment.findMany({ where: { facilityId: facility.id }, orderBy: { code: "asc" } }),
    db().staff.findMany({ where: { facilityId: facility.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db().device.findMany({ where: { facilityId: facility.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const eqById = new Map(equipment.map((e) => [e.id, e]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const deviceName = new Map(devices.map((d) => [d.id, d.name]));

  const filtered = !!(equipmentId || staffId || deviceId);
  // Equipment ids live inside a JSON map per vital sign; filter those in code
  // (a facility's recent readings are small enough).
  const rows = filtered
    ? (
        await db().observation.findMany({
          where: {
            facilityId: facility.id,
            ...(staffId ? { recordedBy: staffId } : {}),
            ...(deviceId ? { deviceId } : {}),
          },
          orderBy: { recordedAt: "desc" },
          take: equipmentId ? 5000 : 500,
          include: { patient: { select: { id: true, givenName: true, familyName: true, ward: true, bed: true } } },
        })
      )
        .filter((o) => !equipmentId || Object.values((o.equipment ?? {}) as Record<string, string>).includes(equipmentId))
        .slice(0, 500)
    : [];
  const scanned = rows.filter((r) => r.patientScanned).length;
  const selectedEq = equipmentId ? eqById.get(equipmentId) : undefined;
  const who = (by: string) => (by === DASHBOARD_ACTOR_ID ? "Admin" : (staffName.get(by) ?? "—"));

  return (
    <>
      <div className="page-head">
        <h1>{t("dash.trace")}</h1>
      </div>
      <Section title={t("dash.filter")}>
        <p className="muted small">{t("dash.traceHelp")}</p>
        <form className="form-row">
          <label>
            {t("dash.instrument")}
            <select name="equipment" defaultValue={equipmentId}>
              <option value="">—</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("dash.staff")}
            <select name="staff" defaultValue={staffId}>
              <option value="">—</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("dash.device")}
            <select name="device" defaultValue={deviceId}>
              <option value="">—</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions" style={{ alignSelf: "end" }}>
            <button className="btn btn-primary" type="submit">
              {t("dash.filter")}
            </button>
          </div>
        </form>
      </Section>

      {filtered && (
        <Section title={`${rows.length} · ${t("vitals.history")}`}>
          {selectedEq && (
            <p className="small">
              <strong>{selectedEq.code}</strong> · {selectedEq.name} · {t(`equipment.kind.${selectedEq.kind}` as MessageKey)}
              {selectedEq.serial ? ` · ${selectedEq.serial}` : ""} · {t("dash.lastChecked")}: {selectedEq.lastCheckedAt ? fmtDate(selectedEq.lastCheckedAt) : "—"}
            </p>
          )}
          {rows.length > 0 && <p className="muted small">{t("dash.scanRate", { pct: Math.round((scanned / rows.length) * 100) })}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("dash.when")}</th>
                  <th>{t("vitals.score")}</th>
                  <th>{t("dash.name")}</th>
                  <th className="num">RR</th>
                  <th className="num">HR</th>
                  <th className="num">TA</th>
                  <th className="num">T °C</th>
                  <th className="num">SpO₂</th>
                  <th>{t("dash.recordedBy")}</th>
                  <th>{t("dash.device")}</th>
                  <th>{t("dash.instrument")}</th>
                  <th>{t("dash.scanned")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const eq = [...new Set(Object.values((o.equipment ?? {}) as Record<string, string>))].map((id) => eqById.get(id)?.code ?? "?");
                  return (
                    <tr key={o.id} className={`row-${o.mewsLevel}`}>
                      <td>{fmtDateTime(o.recordedAt)}</td>
                      <td>
                        <MewsBadge total={o.mewsTotal} level={o.mewsLevel as MewsLevel} complete={o.mewsComplete} />
                      </td>
                      <td>
                        <Link href={`/patients/${o.patient.id}`}>
                          {o.patient.givenName} {o.patient.familyName}
                        </Link>
                        <span className="muted small">
                          {" "}
                          · {o.patient.ward}
                          {o.patient.bed ? ` ${o.patient.bed}` : ""}
                        </span>
                      </td>
                      <td className="num">{fmt(o.rr)}</td>
                      <td className="num">{fmt(o.hr)}</td>
                      <td className="num">
                        {fmt(o.sbp)}/{fmt(o.dbp)}
                      </td>
                      <td className="num">{fmt(o.tempC, 1)}</td>
                      <td className="num">{fmt(o.spo2)}</td>
                      <td className="muted">{who(o.recordedBy)}</td>
                      <td className="muted">{o.deviceId ? (deviceName.get(o.deviceId) ?? "—") : "—"}</td>
                      <td>{eq.length ? eq.join(", ") : "—"}</td>
                      <td>{o.patientScanned ? <span className="pill pill-ok">✓</span> : <span className="pill pill-medium">{t("dash.notScanned")}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
