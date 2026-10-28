import { AVPU, checkVitals, EQUIPMENT_MEASURES, hasBlockingIssue, parseScannedCode, type Avpu, type Equipment, type MessageKey, type Observation } from "@swen/core";
import { ScanSheet } from "../app/ScanSheet";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Banner, Field, MewsPanel, Segmented, TopBar } from "../app/components";
import { useApp, useSession } from "../app/store";
import { bleSupported, readOnce, type BleKind } from "../lib/ble";
import { addObservation, equipmentByCode, getPatient, listPatients, observationsFor, scoreFor, type LocalPatient, type VitalsDraft } from "../lib/repo";

type NumKey = "rr" | "hr" | "sbp" | "dbp" | "tempC" | "spo2";
const NUM_KEYS: NumKey[] = ["rr", "hr", "sbp", "dbp", "tempC", "spo2"];

const UNIT: Record<NumKey, MessageKey> = {
  rr: "vitals.rr.unit",
  hr: "vitals.hr.unit",
  sbp: "vitals.bp.unit",
  dbp: "vitals.bp.unit",
  tempC: "vitals.tempC.unit",
  spo2: "vitals.spo2.unit",
};

function num(s: string): number | null {
  const v = s.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function RecordVitals({ patientId, correctId, visitId = null, next = null }: { patientId: string; correctId: string | null; visitId?: string | null; next?: string | null }) {
  const { t, mews, changed, fmtTime } = useApp();
  const session = useSession();
  const [patient, setPatient] = useState<LocalPatient | null>(null);
  const [original, setOriginal] = useState<Observation | null>(null);
  const [text, setText] = useState<Record<NumKey, string>>({ rr: "", hr: "", sbp: "", dbp: "", tempC: "", spo2: "" });
  const [avpu, setAvpu] = useState<Avpu | null>(null);
  const [sources, setSources] = useState<Record<string, "manual" | "ble">>({});
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ble, setBle] = useState<{ kind: BleKind; status: "waiting" | "error"; message?: string } | null>(null);
  const [bleMsg, setBleMsg] = useState<string | null>(null);
  // Traceability: wristband check and the instruments used.
  const [identity, setIdentity] = useState<"unchecked" | "ok">("unchecked");
  const [wrongPatient, setWrongPatient] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<Equipment[]>([]);
  const [scan, setScan] = useState<"patient" | "equipment" | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void getPatient(session, patientId).then(setPatient);
    if (correctId) {
      void observationsFor(patientId).then((list) => {
        const o = list.find((x) => x.id === correctId);
        if (!o) return;
        setOriginal(o);
        const s = (n: number | null | undefined) => (n == null ? "" : String(n));
        setText({ rr: s(o.rr), hr: s(o.hr), sbp: s(o.sbp), dbp: s(o.dbp), tempC: s(o.tempC), spo2: s(o.spo2) });
        setAvpu(o.avpu ?? null);
        setSources(o.sources ?? {});
        setNote(o.note ?? "");
      });
    }
    return () => abortRef.current?.abort();
  }, [patientId, correctId, session]);

  const values: VitalsDraft = useMemo(() => {
    const out: VitalsDraft = { avpu };
    for (const k of NUM_KEYS) out[k] = num(text[k]);
    return out;
  }, [text, avpu]);

  const issues = useMemo(() => checkVitals(values), [values]);
  const blocking = hasBlockingIssue(issues);
  const needsConfirm = issues.some((i) => i.kind === "soft");
  const issueFor = (k: NumKey) => {
    const i = issues.find((x) => x.field === k || (x.field === "bp" && k === "dbp"));
    return i ? t(`vitals.issue.${i.code}` as MessageKey) : null;
  };
  const hasAny = NUM_KEYS.some((k) => values[k] != null) || !!avpu;
  const result = patient && hasAny && !blocking ? scoreFor(patient, values, mews) : null;

  const setNum = (k: NumKey, s: string) => {
    setText((x) => ({ ...x, [k]: s }));
    setSources((src) => ({ ...src, [k]: "manual" }));
    setConfirmed(false);
  };

  async function readBle(kind: BleKind) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBle({ kind, status: "waiting" });
    setBleMsg(null);
    try {
      const r = await readOnce(kind, ctrl.signal);
      const filled: Partial<Record<NumKey, string>> = {};
      const reading = r as Partial<Record<NumKey, number>>;
      for (const k of NUM_KEYS) if (reading[k] != null) filled[k] = String(reading[k]);
      setText((x) => ({ ...x, ...filled }));
      setSources((src) => ({ ...src, ...Object.fromEntries(Object.keys(filled).map((k) => [k, "ble" as const])) }));
      setBle(null);
      setBleMsg(t("ble.received", { device: r.deviceName }));
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError" || err.name === "NotFoundError") setBle(null); // cancelled in the chooser
      else setBle({ kind, status: "error", message: t("ble.error", { message: err.message }) });
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!patient || !hasAny || blocking || (needsConfirm && !confirmed) || wrongPatient) return;
    setBusy(true);
    try {
      const clean: Record<string, "manual" | "ble"> = {};
      for (const [k, s] of Object.entries(sources)) if (values[k as NumKey] != null) clean[k] = s;
      // Each vital sign is linked to the instrument that measures that kind of value.
      const equipment: Record<string, string> = {};
      for (const eq of instruments) for (const k of EQUIPMENT_MEASURES[eq.kind]) if (values[k] != null && !equipment[k]) equipment[k] = eq.id;
      const { observation, mews: score } = await addObservation(
        session,
        patient,
        { ...values, sources: clean, note, patientScanned: identity === "ok", equipment, visitId },
        { supersedes: original ?? undefined },
      );
      changed();
      // Anything above routine monitoring asks the nurse what they did.
      const after = score.level !== "low" ? `#/escalate/${observation.id}` : next === "queue" ? "#/queue" : `#/patient/${patient.id}`;
      window.location.replace(after);
    } finally {
      setBusy(false);
    }
  }

  const numField = (k: NumKey, label: MessageKey, step = "1") => (
    <Field label={t(label)} error={issueFor(k)} hint={sources[k] === "ble" ? `ᛒ ${t("vitals.fromDevice")}` : t(UNIT[k])}>
      <input
        className="num-input"
        type="text"
        inputMode={step === "1" ? "numeric" : "decimal"}
        pattern="[0-9]*[.,]?[0-9]*"
        value={text[k]}
        onChange={(e) => setNum(k, e.target.value)}
        aria-invalid={!!issueFor(k)}
        autoComplete="off"
      />
    </Field>
  );

  if (!patient) return <TopBar title="…" backTo={`/patient/${patientId}`} />;

  return (
    <>
      <TopBar title={t("vitals.record")} sub={`${patient.givenName} ${patient.familyName} · ${patient.ward}${patient.bed ? ` · ${patient.bed}` : ""}`} backTo={`/patient/${patientId}`} />
      <main className="content vitals-layout">
        <form className="vitals-form" onSubmit={save} noValidate>
          {original && <Banner tone="info">{t("vitals.correcting", { time: fmtTime(original.recordedAt) })}</Banner>}

          {wrongPatient ? (
            <Banner tone="danger" action={<button type="button" className="btn btn-quiet" onClick={() => setScan("patient")}>{t("scan.patient")}</button>}>
              {t("vitals.identityWrong", { name: wrongPatient })}
            </Banner>
          ) : identity === "ok" ? (
            <Banner tone="ok">✓ {t("vitals.identityOk")}</Banner>
          ) : (
            <Banner tone="warn" action={<button type="button" className="btn btn-primary" onClick={() => setScan("patient")}>{t("scan.patient")}</button>}>
              {t("vitals.confirmIdentity")}
            </Banner>
          )}

          <div className="instruments">
            <span className="field-label">{t("vitals.instruments")}</span>
            <div className="chips">
              {instruments.map((eq) => (
                <button type="button" key={eq.id} className="on" onClick={() => setInstruments((list) => list.filter((x) => x.id !== eq.id))} title="✕">
                  {eq.code} · {t(`equipment.kind.${eq.kind}` as MessageKey)} ✕
                </button>
              ))}
              <button type="button" onClick={() => setScan("equipment")}>
                + {t("scan.equipment")}
              </button>
            </div>
            {instruments
              .filter((eq) => !eq.active)
              .map((eq) => (
                <Banner key={eq.id} tone="warn">
                  {t("vitals.instrumentInactive", { name: eq.code })}
                </Banner>
              ))}
          </div>

          {scan && (
            <ScanSheet
              title={scan === "patient" ? t("scan.patient") : t("scan.equipment")}
              onClose={() => setScan(null)}
              onCode={async (raw) => {
                const code = parseScannedCode(raw);
                if (scan === "patient") {
                  if (code.kind !== "patient") return t("scan.wrongKind");
                  if (code.value !== patient.id) {
                    // Show WHOSE wristband it is, so the mix-up is obvious.
                    const other = (await listPatients(session, { includeDischarged: true })).find((p) => p.id === code.value);
                    setWrongPatient(other ? `${other.givenName} ${other.familyName}` : code.value.slice(0, 8));
                    setIdentity("unchecked");
                    setScan(null);
                    return;
                  }
                  setWrongPatient(null);
                  setIdentity("ok");
                  setScan(null);
                  return;
                }
                // Instruments: an asset tag (SWEN:EQ:OXI-001) or the bare code.
                const value = code.kind === "equipment" ? code.value : code.kind === "item" ? code.value : null;
                if (!value) return t("scan.wrongKind");
                const eq = await equipmentByCode(value);
                if (!eq) return t("scan.unknown", { code: value });
                setInstruments((list) => [...list.filter((x) => x.kind !== eq.kind), eq]);
                setScan(null);
              }}
            />
          )}

          <div className="ble-row">
            {bleSupported() ? (
              (["oximeter", "bp", "thermometer"] as BleKind[]).map((k) => (
                <button type="button" key={k} className={`btn btn-ble ${ble?.kind === k && ble.status === "waiting" ? "busy" : ""}`} onClick={() => void readBle(k)}>
                  ᛒ {t(`ble.${k}` as MessageKey)}
                </button>
              ))
            ) : (
              <p className="muted small">{t("ble.unsupported")}</p>
            )}
          </div>
          {ble?.status === "waiting" && (
            <Banner tone="info" action={<button type="button" className="btn btn-quiet" onClick={() => abortRef.current?.abort()}>{t("common.cancel")}</button>}>
              {t("ble.waiting")}
            </Banner>
          )}
          {ble?.status === "error" && <Banner tone="warn">{ble.message}</Banner>}
          {bleMsg && <Banner tone="ok">{bleMsg}</Banner>}

          <div className="vitals-grid-input">
            {numField("rr", "vitals.rr")}
            {numField("hr", "vitals.hr")}
            {numField("sbp", "vitals.sbp")}
            {numField("dbp", "vitals.dbp")}
            {numField("tempC", "vitals.tempC", "0.1")}
            {numField("spo2", "vitals.spo2")}
          </div>

          <Field label={t("vitals.avpu")}>
            <Segmented
              name={t("vitals.avpu")}
              value={avpu}
              onChange={(a) => {
                setAvpu(a);
                setConfirmed(false);
              }}
              options={AVPU.map((a) => ({ value: a, label: a, sub: t(`vitals.avpu.${a}` as MessageKey) }))}
            />
          </Field>

          <Field label={t("vitals.note")} hint={t("common.optional")}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
          </Field>

          {needsConfirm && !blocking && (
            <label className="check big confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t("vitals.confirmExtreme")}
            </label>
          )}

          <button className="btn btn-primary btn-lg" disabled={busy || !hasAny || blocking || (needsConfirm && !confirmed) || !!wrongPatient}>
            {t("vitals.save")}
          </button>
        </form>

        <aside className="vitals-score">
          {result ? <MewsPanel result={result} cfg={mews} /> : <div className="mews-panel mews-empty"><span className="mews-label">{t("vitals.score")}</span><span className="mews-number">–</span></div>}
        </aside>
      </main>
    </>
  );
}
