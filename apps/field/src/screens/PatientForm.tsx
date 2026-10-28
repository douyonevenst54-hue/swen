import { birthYearFrom, Sex, type BirthDatePrecision, type DuplicateMatch, type MessageKey } from "@swen/core";
import { useEffect, useState, type FormEvent } from "react";
import { Field, Segmented, TopBar } from "../app/components";
import { back, go } from "../app/router";
import { useApp, useSession } from "../app/store";
import { getPatient, likelyDuplicates, savePatient, type LocalPatient, type PatientInput } from "../lib/repo";

const WARD_KEY = "swen.ward";

type Mode = "ward" | "desk";

/**
 * New or edited patient. Two entry points:
 *  - "desk" (#/register): registration at the front desk, then check-in.
 *  - "ward" (#/patient/new from the ward list): an admitted patient, then vitals.
 * New records are checked against existing ones before they are created.
 */
export function PatientForm({ id, mode = "ward", prefillName, prefillYear }: { id?: string; mode?: Mode; prefillName?: string | null; prefillYear?: number | null }) {
  const { t, changed } = useApp();
  const session = useSession();
  const [form, setForm] = useState<PatientInput>(() => {
    let ward = "";
    if (mode === "ward") {
      try {
        ward = localStorage.getItem(WARD_KEY) ?? "";
      } catch {
        /* ignore */
      }
    }
    // "Jan Pyè" typed in the search box: first word is the given name, the rest the family name.
    const words = (prefillName ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toLocaleUpperCase("fr") + w.slice(1));
    return {
      ward,
      givenName: words.slice(0, 1).join(" "),
      familyName: words.slice(1).join(" "),
      sex: "F",
      bed: "",
      mrn: "",
      birthYear: prefillYear ?? null,
      birthDatePrecision: "year",
      isPregnant: false,
      notes: "",
    };
  });
  const [precision, setPrecision] = useState<BirthDatePrecision>("year");
  const [birthDate, setBirthDate] = useState("");
  const [yearText, setYearText] = useState(prefillYear ? String(prefillYear) : "");
  const [ageText, setAgeText] = useState("");
  const [number, setNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<DuplicateMatch<LocalPatient>[] | null>(null);
  const thisYear = new Date().getFullYear();

  useEffect(() => {
    if (!id) return;
    void getPatient(session, id).then((p) => {
      if (!p) return;
      const { dirty: _d, ...rest } = p;
      void _d;
      setForm({ ...rest, bed: p.bed ?? "", mrn: p.mrn ?? "", notes: p.notes ?? "" });
      setNumber(p.number ?? null);
      const prec = p.birthDatePrecision ?? "year";
      setPrecision(prec);
      setBirthDate(p.birthDate ?? "");
      setYearText(p.birthYear ? String(p.birthYear) : "");
      setAgeText(p.birthYear ? String(thisYear - p.birthYear) : "");
    });
  }, [id, session, thisYear]);

  const set = <K extends keyof PatientInput>(k: K, v: PatientInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof PatientInput, label: MessageKey, max: number, extra: Record<string, unknown> = {}) => (
    <Field label={t(label)} hint={t("common.optional")}>
      <input value={(form[k] as string | null | undefined) ?? ""} onChange={(e) => set(k, e.target.value as never)} maxLength={max} autoComplete="off" {...extra} />
    </Field>
  );

  const birthYear = birthYearFrom({ precision, date: birthDate, year: yearText ? Number(yearText) : null, age: ageText ? Number(ageText) : null });
  const complete = (): PatientInput => ({
    ...form,
    birthYear,
    birthDate: precision === "exact" ? birthDate || null : null,
    birthDatePrecision: birthYear ? precision : null,
    isPregnant: form.sex === "F" ? form.isPregnant : false,
  });

  async function save(input: PatientInput) {
    setBusy(true);
    try {
      const saved = await savePatient(session, { ...input, id });
      changed();
      if (id) back(`/patient/${id}`);
      else if (mode === "desk") go(`/queue?checkin=${saved.id}`);
      else go(`/patient/${saved.id}/vitals`);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = complete();
    if (!id) {
      const found = await likelyDuplicates(session, input);
      if (found.length) {
        setDupes(found);
        return;
      }
    }
    await save(input);
  }

  function pickExisting(p: LocalPatient) {
    setDupes(null);
    if (mode === "desk") go(`/queue?checkin=${p.id}`);
    else go(`/patient/${p.id}`);
  }

  return (
    <>
      <TopBar title={id ? t("patients.edit") : mode === "desk" ? t("search.register") : t("patients.add")} sub={number ?? undefined} backTo={id ? `/patient/${id}` : mode === "desk" ? "/queue" : "/"} />
      <main className="content narrow">
        <form onSubmit={submit} className="stack">
          <h2 className="form-section">{t("patients.section.identity")}</h2>
          <div className="grid-2">
            <Field label={t("patients.givenName")}>
              <input value={form.givenName} onChange={(e) => set("givenName", e.target.value)} required maxLength={120} autoComplete="off" />
            </Field>
            <Field label={t("patients.familyName")}>
              <input value={form.familyName} onChange={(e) => set("familyName", e.target.value)} required maxLength={120} autoComplete="off" />
            </Field>
          </div>
          {text("otherNames", "patients.otherNames", 200)}
          <Field label={t("patients.sex")}>
            <Segmented name={t("patients.sex")} value={form.sex} onChange={(v) => set("sex", v)} options={Sex.options.map((s) => ({ value: s, label: t(`patients.sex.${s}`) }))} />
          </Field>
          <Field label={t("patients.birth")} hint={birthYear ? t("patients.age", { n: thisYear - birthYear }) : t("common.optional")}>
            <Segmented
              name={t("patients.birth")}
              value={precision}
              onChange={setPrecision}
              options={(["exact", "year", "estimated"] as const).map((p) => ({ value: p, label: t(`patients.birth.${p}`) }))}
            />
          </Field>
          {precision === "exact" && (
            <Field label={t("patients.birth")}>
              <input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthDate(e.target.value)} />
            </Field>
          )}
          {precision === "year" && (
            <Field label={t("patients.birthYear")}>
              <input type="number" inputMode="numeric" min={1900} max={thisYear} value={yearText} onChange={(e) => setYearText(e.target.value)} />
            </Field>
          )}
          {precision === "estimated" && (
            <Field label={t("patients.estimatedAge")}>
              <input type="number" inputMode="numeric" min={0} max={120} value={ageText} onChange={(e) => setAgeText(e.target.value)} />
            </Field>
          )}
          {form.sex === "F" && (
            <label className="check big">
              <input type="checkbox" checked={!!form.isPregnant} onChange={(e) => set("isPregnant", e.target.checked)} />
              {t("patients.pregnant")}
            </label>
          )}
          {text("motherName", "patients.motherName", 120)}
          {text("nationalId", "patients.nationalId", 40)}

          <h2 className="form-section">{t("patients.section.contact")}</h2>
          <div className="grid-2">
            {text("phone", "patients.phone", 40, { type: "tel", inputMode: "tel" })}
            {text("commune", "patients.commune", 80)}
          </div>
          {text("address", "patients.address", 200)}
          <fieldset className="subgroup">
            <legend>{t("patients.emergency")}</legend>
            <div className="grid-3">
              {text("emergencyName", "patients.emergencyName", 120)}
              {text("emergencyRelation", "patients.emergencyRelation", 60)}
              {text("emergencyPhone", "patients.emergencyPhone", 40, { type: "tel", inputMode: "tel" })}
            </div>
          </fieldset>

          <h2 className="form-section">{t("patients.section.ward")}</h2>
          <div className="grid-3">
            <Field label={t("patients.ward")} hint={mode === "desk" ? t("common.optional") : undefined}>
              <input value={form.ward} onChange={(e) => set("ward", e.target.value)} required={mode === "ward"} maxLength={60} />
            </Field>
            <Field label={t("patients.bed")} hint={t("common.optional")}>
              <input value={form.bed ?? ""} onChange={(e) => set("bed", e.target.value)} maxLength={20} />
            </Field>
            <Field label={t("patients.mrn")} hint={t("common.optional")}>
              <input value={form.mrn ?? ""} onChange={(e) => set("mrn", e.target.value)} maxLength={60} />
            </Field>
          </div>
          <Field label={t("patients.notes")} hint={t("common.optional")}>
            <textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={2000} />
          </Field>
          {!id && !number && <p className="muted small">{t("patients.numberPending")}</p>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {id ? t("common.save") : mode === "desk" ? t("patients.saveAndCheckIn") : t("patients.saveAndRecord")}
          </button>
        </form>
      </main>

      {dupes && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={t("dup.title")}>
          <div className="sheet-card">
            <h2>{t("dup.title")}</h2>
            <p>{t("dup.intro")}</p>
            <ul className="result-list">
              {dupes.map(({ person: p, reasons }) => (
                <li key={p.id}>
                  <span className="result-main">
                    <strong>
                      {p.givenName} {p.familyName}
                      {p.otherNames ? <span className="muted"> ({p.otherNames})</span> : null}
                    </strong>
                    <small>
                      {[t(`patients.sex.${p.sex}` as MessageKey), p.birthYear, p.commune, p.motherName ? t("patients.mother", { name: p.motherName }) : null, p.phone, p.number]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <small className="reasons">{reasons.map((r) => t(`dup.reason.${r}` as MessageKey)).join(", ")}</small>
                  </span>
                  <button className="btn btn-primary" onClick={() => pickExisting(p)}>
                    {t("dup.useThis")}
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => {
                setDupes(null);
                void save(complete());
              }}
            >
              {t("dup.createNew")}
            </button>
            <button className="btn btn-quiet" onClick={() => setDupes(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
