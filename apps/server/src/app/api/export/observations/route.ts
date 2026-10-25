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

  const rows = await db().observation.findMany({
    where: { facilityId: facility.id },
    orderBy: { recordedAt: "asc" },
    include: { patient: { select: { ward: true, bed: true, mrn: true, givenName: true, familyName: true, sex: true, birthYear: true } } },
  });
  const header = [
    "observation_id", "recorded_at", "patient_id", "mrn", "given_name", "family_name", "sex", "birth_year", "ward", "bed",
    "rr", "hr", "sbp", "dbp", "temp_c", "spo2", "avpu", "mews_total", "mews_level", "mews_complete", "supersedes_id", "recorded_by", "note",
  ];
  const lines = [header.join(",")];
  for (const o of rows) {
    lines.push(
      [
        o.id, o.recordedAt, o.patientId, o.patient.mrn, o.patient.givenName, o.patient.familyName, o.patient.sex, o.patient.birthYear, o.patient.ward, o.patient.bed,
        o.rr, o.hr, o.sbp, o.dbp, o.tempC, o.spo2, o.avpu, o.mewsTotal, o.mewsLevel, o.mewsComplete, o.supersedesId, o.recordedBy, o.note,
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
