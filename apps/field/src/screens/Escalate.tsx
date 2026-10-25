import { EscalationAction, type MessageKey, type Observation } from "@swen/core";
import { useEffect, useState, type FormEvent } from "react";
import { Field, MewsPanel, TopBar } from "../app/components";
import { useApp, useSession } from "../app/store";
import { localDb } from "../lib/db";
import { addEscalation, getPatient, scoreFor, type LocalPatient } from "../lib/repo";

/**
 * After a MEDIUM or HIGH score, the nurse records what they did. This is the
 * safety loop: the dashboard shows every high score without an action.
 */
export function Escalate({ observationId }: { observationId: string }) {
  const { t, mews, changed } = useApp();
  const session = useSession();
  const [obs, setObs] = useState<Observation | null>(null);
  const [patient, setPatient] = useState<LocalPatient | null>(null);
  const [actions, setActions] = useState<Set<EscalationAction>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void localDb()
      .observations.get(observationId)
      .then(async (o) => {
        if (!o) return;
        setObs(o);
        setPatient(await getPatient(session, o.patientId));
      });
  }, [observationId, session]);

  if (!obs || !patient) return <TopBar title={t("escalation.title")} backTo="/" />;
  const result = scoreFor(patient, obs, mews, new Date(obs.recordedAt));
  const done = () => window.location.replace(`#/patient/${patient.id}`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!actions.size || !obs) return;
    setBusy(true);
    // The note goes with the first action recorded, so it is never dropped.
    let first = true;
    for (const a of actions) {
      await addEscalation(session, obs, a, first ? note : null);
      first = false;
    }
    changed();
    done();
  }

  const toggle = (a: EscalationAction) =>
    setActions((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  return (
    <>
      <TopBar title={t("escalation.title")} sub={`${patient.givenName} ${patient.familyName} · ${patient.ward}${patient.bed ? ` · ${patient.bed}` : ""}`} />
      <main className="content narrow">
        <MewsPanel result={result} cfg={mews} />
        <form onSubmit={submit} className="stack">
          <h2>{t("escalation.question")}</h2>
          <div className="choice-list">
            {EscalationAction.options.map((a) => (
              <label key={a} className={`choice ${actions.has(a) ? "on" : ""}`}>
                <input type="checkbox" checked={actions.has(a)} onChange={() => toggle(a)} />
                {t(`escalation.action.${a}` as MessageKey)}
              </label>
            ))}
          </div>
          <Field label={t("vitals.note")} hint={t("common.optional")}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
          </Field>
          <button className="btn btn-primary btn-lg" disabled={busy || actions.size === 0}>
            {t("escalation.record")}
          </button>
          {/* Never trap the nurse here; an unrecorded action stays visible on the ward list and dashboard. */}
          <button type="button" className="btn btn-quiet" onClick={done}>
            {t("escalation.later")}
          </button>
        </form>
      </main>
    </>
  );
}
