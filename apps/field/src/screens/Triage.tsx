import { ageInYears, type MessageKey, type TriageColor, type VisitKind } from "@swen/core";
import { useEffect, useState, type FormEvent } from "react";
import { Banner, Empty, Field, TopBar } from "../app/components";
import { go } from "../app/router";
import { useApp, useSession } from "../app/store";
import type { VisitRow } from "../lib/db";
import { getPatient, getVisit, updateVisit, type LocalPatient } from "../lib/repo";
import { TRIAGE_COLORS } from "./Queue";

/** Triage at arrival: main complaint and colour, then the vitals. */
export function Triage({ visitId }: { visitId: string }) {
  const { t, changed } = useApp();
  const session = useSession();
  const [visit, setVisit] = useState<VisitRow | null | undefined>(undefined);
  const [patient, setPatient] = useState<LocalPatient | null>(null);
  const [color, setColor] = useState<TriageColor | null>(null);
  const [complaint, setComplaint] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getVisit(visitId).then(async (v) => {
      setVisit(v ?? null);
      if (!v) return;
      setColor(v.triageColor ?? null);
      setComplaint(v.chiefComplaint ?? "");
      setPatient(await getPatient(session, v.patientId));
    });
  }, [visitId, session]);

  if (visit === undefined) return <TopBar title="…" backTo="/queue" />;
  if (visit === null)
    return (
      <>
        <TopBar title={t("triage.title")} backTo="/queue" />
        <Empty>{t("patients.notFound")}</Empty>
      </>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!color || !visit) return;
    setBusy(true);
    try {
      await updateVisit(session, visit.id, { status: visit.status === "waiting" ? "triaged" : undefined, triageColor: color, chiefComplaint: complaint });
      changed();
      go(`/patient/${visit.patientId}/vitals?visit=${visit.id}&next=queue`);
    } finally {
      setBusy(false);
    }
  }

  const age = patient ? ageInYears(patient.birthYear) : null;
  const kind: VisitKind = visit.kind;
  return (
    <>
      <TopBar
        title={`${t("triage.title")}: ${patient ? `${patient.givenName} ${patient.familyName}` : "…"}`}
        sub={[t(`visit.kind.${kind}` as MessageKey), visit.service, age != null ? t("patients.age", { n: age }) : null].filter(Boolean).join(" · ")}
        backTo="/queue"
      />
      <main className="content narrow">
        <form className="stack" onSubmit={submit}>
          <Field label={t("visit.complaint")}>
            <input value={complaint} onChange={(e) => setComplaint(e.target.value)} maxLength={300} autoFocus />
          </Field>
          <fieldset className="subgroup">
            <legend>{t("triage.color")}</legend>
            <div className="triage-picker" role="radiogroup" aria-label={t("triage.color")}>
              {TRIAGE_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} className={`tri-option tri-${c} ${color === c ? "on" : ""}`} onClick={() => setColor(c)}>
                  {t(`triage.${c}` as MessageKey)}
                </button>
              ))}
            </div>
          </fieldset>
          {color === "red" && <Banner tone="danger">{t("vitals.level.high")}</Banner>}
          <button className="btn btn-primary btn-lg" disabled={busy || !color}>
            {t("triage.saveAndVitals")}
          </button>
        </form>
      </main>
    </>
  );
}
