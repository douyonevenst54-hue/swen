import { Sex } from "@swen/core";
import { useEffect, useState, type FormEvent } from "react";
import { Field, Segmented, TopBar } from "../app/components";
import { back, go } from "../app/router";
import { useApp, useSession } from "../app/store";
import { getPatient, savePatient, type PatientInput } from "../lib/repo";

const WARD_KEY = "swen.ward";

export function PatientForm({ id }: { id?: string }) {
  const { t, changed } = useApp();
  const session = useSession();
  const [form, setForm] = useState<PatientInput>(() => {
    let ward = "";
    try {
      ward = localStorage.getItem(WARD_KEY) ?? "";
    } catch {
      /* ignore */
    }
    return { ward, givenName: "", familyName: "", sex: "F", bed: "", mrn: "", birthYear: null, isPregnant: false, notes: "" };
  });
  const [busy, setBusy] = useState(false);
  const thisYear = new Date().getFullYear();

  useEffect(() => {
    if (!id) return;
    void getPatient(session, id).then((p) => p && setForm({ ...p, bed: p.bed ?? "", mrn: p.mrn ?? "", notes: p.notes ?? "" }));
  }, [id, session]);

  const set = <K extends keyof PatientInput>(k: K, v: PatientInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await savePatient(session, { ...form, id, isPregnant: form.sex === "F" ? form.isPregnant : false });
      changed();
      if (id) back(`/patient/${id}`);
      else go(`/patient/${saved.id}/vitals`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title={id ? t("patients.edit") : t("patients.add")} backTo={id ? `/patient/${id}` : "/"} />
      <main className="content narrow">
        <form onSubmit={submit} className="stack">
          <div className="grid-2">
            <Field label={t("patients.givenName")}>
              <input value={form.givenName} onChange={(e) => set("givenName", e.target.value)} required maxLength={120} autoComplete="off" />
            </Field>
            <Field label={t("patients.familyName")}>
              <input value={form.familyName} onChange={(e) => set("familyName", e.target.value)} required maxLength={120} autoComplete="off" />
            </Field>
          </div>
          <div className="grid-3">
            <Field label={t("patients.ward")}>
              <input value={form.ward} onChange={(e) => set("ward", e.target.value)} required maxLength={60} />
            </Field>
            <Field label={t("patients.bed")}>
              <input value={form.bed ?? ""} onChange={(e) => set("bed", e.target.value)} maxLength={20} />
            </Field>
            <Field label={t("patients.mrn")}>
              <input value={form.mrn ?? ""} onChange={(e) => set("mrn", e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Field label={t("patients.sex")}>
            <Segmented name={t("patients.sex")} value={form.sex} onChange={(v) => set("sex", v)} options={Sex.options.map((s) => ({ value: s, label: t(`patients.sex.${s}`) }))} />
          </Field>
          <div className="grid-2">
            <Field label={t("patients.birthYear")} hint={form.birthYear ? t("patients.age", { n: thisYear - form.birthYear }) : t("common.optional")}>
              <input
                type="number"
                inputMode="numeric"
                min={1900}
                max={thisYear}
                value={form.birthYear ?? ""}
                onChange={(e) => set("birthYear", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
            {form.sex === "F" && (
              <label className="check big">
                <input type="checkbox" checked={!!form.isPregnant} onChange={(e) => set("isPregnant", e.target.checked)} />
                {t("patients.pregnant")}
              </label>
            )}
          </div>
          <Field label={t("patients.notes")} hint={t("common.optional")}>
            <textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {id ? t("common.save") : t("patients.saveAndRecord")}
          </button>
        </form>
      </main>
    </>
  );
}
