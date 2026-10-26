import { LEVEL_RANK, latestByPatient, minutesOverdue, parseScannedCode, type MewsLevel } from "@swen/core";
import { ScanSheet } from "../app/ScanSheet";
import { useEffect, useMemo, useState } from "react";
import { BottomNav, Empty, Fab, MewsBadge, TopBar } from "../app/components";
import { go } from "../app/router";
import { useApp, useSession } from "../app/store";
import type { ObservationRow } from "../lib/db";
import { acknowledgedObservationIds, listPatients, recentObservations, type LocalPatient } from "../lib/repo";

interface Row {
  p: LocalPatient;
  latest: ObservationRow | undefined;
  overdue: number | null;
  acked: boolean;
}

const WARD_KEY = "swen.ward";

export function Ward() {
  const { t, fmtRelative, mews, dataVersion, device } = useApp();
  const session = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [ward, setWard] = useState<string>(() => {
    try {
      return localStorage.getItem(WARD_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [showDischarged, setShowDischarged] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const patients = await listPatients(session, { includeDischarged: showDischarged });
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const latest = latestByPatient(await recentObservations(since));
      const acked = await acknowledgedObservationIds([...latest.values()].map((o) => o.id));
      const now = Date.now();
      const out = patients.map((p) => {
        const o = latest.get(p.id);
        return { p, latest: o, overdue: o?.mewsLevel ? minutesOverdue(o.recordedAt, o.mewsLevel, mews, now) : null, acked: o ? acked.has(o.id) : false };
      });
      if (alive) setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, [session, dataVersion, mews, showDischarged]);

  const wards = useMemo(() => [...new Set((rows ?? []).map((r) => r.p.ward))].sort(), [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => !ward || r.p.ward === ward)
      .filter((r) => !q || `${r.p.givenName} ${r.p.familyName} ${r.p.bed ?? ""} ${r.p.mrn ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const la = a.latest?.mewsLevel ? LEVEL_RANK[a.latest.mewsLevel as MewsLevel] : -1;
        const lb = b.latest?.mewsLevel ? LEVEL_RANK[b.latest.mewsLevel as MewsLevel] : -1;
        if (la !== lb) return lb - la;
        if ((b.overdue ?? -1e9) !== (a.overdue ?? -1e9)) return (b.overdue ?? -1e9) - (a.overdue ?? -1e9);
        return (a.p.bed ?? "").localeCompare(b.p.bed ?? "", undefined, { numeric: true });
      });
  }, [rows, ward, query]);

  const pickWard = (w: string) => {
    setWard(w);
    try {
      localStorage.setItem(WARD_KEY, w);
    } catch {
      /* private mode */
    }
  };

  return (
    <>
      <TopBar title={ward || t("patients.allWards")} sub={device?.facility.name} />
      <main className="content">
        <div className="toolbar">
          <div className="toolbar">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("patients.searchPlaceholder")} aria-label={t("common.search")} />
            <button className="btn btn-primary" onClick={() => setScanning(true)}>
              {t("scan.patient")}
            </button>
          </div>
          {wards.length > 1 && (
            <div className="chips" role="tablist">
              <button className={!ward ? "on" : ""} onClick={() => pickWard("")}>
                {t("common.all")}
              </button>
              {wards.map((w) => (
                <button key={w} className={ward === w ? "on" : ""} onClick={() => pickWard(w)}>
                  {w}
                </button>
              ))}
            </div>
          )}
        </div>

        {rows === null ? (
          <p className="muted pad">{t("common.loading")}</p>
        ) : shown.length === 0 ? (
          <Empty action={<button className="btn btn-primary" onClick={() => go("/patient/new")}>{t("patients.add")}</button>}>{t("patients.empty")}</Empty>
        ) : (
          <ul className="patient-list">
            {shown.map(({ p, latest, overdue, acked }) => {
              const level = latest?.mewsLevel as MewsLevel | undefined;
              return (
                <li key={p.id} className={`patient-row ${level ? `lvl-${level}` : ""} ${p.dischargedAt ? "discharged" : ""}`}>
                  <a href={`#/patient/${p.id}`}>
                    <MewsBadge total={latest?.mewsTotal} level={level} />
                    <span className="patient-main">
                      <strong>
                        {p.givenName} {p.familyName}
                      </strong>
                      <small>
                        {p.ward}
                        {p.bed ? ` · ${t("patients.bed")} ${p.bed}` : ""}
                        {p.dischargedAt ? ` · ${t("patients.discharged")}` : ""}
                      </small>
                    </span>
                    <span className="patient-meta">
                      {latest ? <small>{fmtRelative(latest.recordedAt)}</small> : <small className="muted">{t("patients.noVitals")}</small>}
                      {!p.dischargedAt && overdue !== null && overdue > 0 && <span className="tag tag-warn">{t("patients.overdue", { time: t("common.minutes", { n: overdue }) })}</span>}
                      {!p.dischargedAt && !latest && <span className="tag tag-warn">{t("patients.due")}</span>}
                      {level && level !== "low" && !acked && <span className="tag tag-danger">{t("escalation.pending")}</span>}
                      {p.dirty === 1 && <span className="tag">↻</span>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <label className="check pad">
          <input type="checkbox" checked={showDischarged} onChange={(e) => setShowDischarged(e.target.checked)} />
          {t("patients.showDischarged")}
        </label>
      </main>
      {scanning && (
        <ScanSheet
          title={t("scan.patient")}
          onClose={() => setScanning(false)}
          onCode={(raw) => {
            const code = parseScannedCode(raw);
            if (code.kind !== "patient") return t("scan.wrongKind");
            const found = rows?.find((r) => r.p.id === code.value);
            if (!found) return t("scan.unknown", { code: code.value.slice(0, 8) });
            setScanning(false);
            go(`/patient/${found.p.id}`);
          }}
        />
      )}
      <Fab href="/patient/new" label={t("patients.add")} />
      <BottomNav current="ward" />
    </>
  );
}
