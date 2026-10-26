import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Stop spreadsheet apps from running cell text as a formula.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** All observations for the current facility as CSV (for audit, research or reporting). */
export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const { facility } = await currentFacility();
  if (!facility) return new Response("No facility", { status: 404 });

  const [equipment, devices] = await Promise.all([
    db().equipment.findMany({ where: { facilityId: facility.id }, select: { id: true, code: true } }),
    db().device.findMany({ where: { facilityId: facility.id }, select: { id: true, name: true } }),
  ]);
  const eqCode = new Map(equipment.map((e) => [e.id, e.code]));
  const devName = new Map(devices.map((d) => [d.id, d.name]));
  const instrument = (map: unknown, key: string) => {
    const id = (map as Record<string, string> | null)?.[key];
    return id ? (eqCode.get(id) ?? id) : "";
  };
  const rows = await db().observation.findMany({
    where: { facilityId: facility.id },
    orderBy: { recordedAt: "asc" },
    include: { patient: { select: { ward: true, bed: true, mrn: true, givenName: true, familyName: true, sex: true, birthYear: true } } },
  });
  const header = [
    "observation_id", "recorded_at", "patient_id", "mrn", "given_name", "family_name", "sex", "birth_year", "ward", "bed",
    "rr", "hr", "sbp", "dbp", "temp_c", "spo2", "avpu", "mews_total", "mews_level", "mews_complete", "supersedes_id", "recorded_by", "note",
    "device_id", "device_name", "patient_scanned", "instrument_rr", "instrument_hr", "instrument_bp", "instrument_temp", "instrument_spo2",
  ];
  const lines = [header.join(",")];
  for (const o of rows) {
    lines.push(
      [
        o.id, o.recordedAt, o.patientId, o.patient.mrn, o.patient.givenName, o.patient.familyName, o.patient.sex, o.patient.birthYear, o.patient.ward, o.patient.bed,
        o.rr, o.hr, o.sbp, o.dbp, o.tempC, o.spo2, o.avpu, o.mewsTotal, o.mewsLevel, o.mewsComplete, o.supersedesId, o.recordedBy, o.note,
        o.deviceId, o.deviceId ? devName.get(o.deviceId) : "", o.patientScanned,
        instrument(o.equipment, "rr"), instrument(o.equipment, "hr"), instrument(o.equipment, "sbp"), instrument(o.equipment, "tempC"), instrument(o.equipment, "spo2"),
      ].map(esc).join(","),
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="swen-observations-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
