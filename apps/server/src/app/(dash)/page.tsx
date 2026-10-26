import { describeStockAlert } from "@swen/core";
import Link from "next/link";
import { MewsBadge, Section, Stat } from "@/components/ui";
import { LEFT_OPEN_MINUTES } from "@/lib/cabinets";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";
import { inventoryView, staffNames, wardBoard } from "@/lib/queries";

export default async function Overview() {
  const { t, fmtRelative, fmtDate, locale } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility) {
    return (
      <Section title={t("dash.facilities")}>
        <p>
          <Link href="/admin">{t("dash.addFacility")} →</Link>
        </p>
      </Section>
    );
  }

  const now = Date.now();
  const [{ rows }, inv, names, devices, cabinets] = await Promise.all([
    wardBoard(db(), facility.id, now),
    inventoryView(db(), facility.id),
    staffNames(db(), facility.id),
    db().device.findMany({ where: { facilityId: facility.id, revokedAt: null }, orderBy: { lastSeenAt: "desc" } }),
    db().cabinet.findMany({
      where: { facilityId: facility.id },
      include: { events: { orderBy: { at: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    }),
  ]);

  const atRisk = rows.filter((r) => r.latest && r.latest.mewsLevel !== "low");
  const high = atRisk.filter((r) => r.latest!.mewsLevel === "high");
  const unacked = high.filter((r) => !r.acknowledged);
  const overdue = rows.filter((r) => (r.minutesOverdue ?? -1) > 0);
  const itemName = new Map(inv.items.map((i) => [i.id, locale === "fr" ? i.nameFr : i.nameHt]));
  const staleDevices = devices.filter((d) => !d.lastSeenAt || now - d.lastSeenAt.getTime() > 24 * 3600_000);

  return (
    <>
      <div className="page-head">
        <h1>{t("dash.overview")}</h1>
      </div>

      <div className="stats">
        <Stat label={t("dash.patients")} value={rows.length} />
        <Stat label={t("dash.stat.high")} value={high.length} tone={high.length ? "high" : "ok"} />
        <Stat label={t("dash.stat.medium")} value={atRisk.length - high.length} tone={atRisk.length - high.length ? "medium" : "ok"} />
        <Stat label={t("dash.unacknowledged")} value={unacked.length} tone={unacked.length ? "high" : "ok"} />
        <Stat label={t("patients.due")} value={overdue.length} tone={overdue.length ? "medium" : "ok"} />
        <Stat label={t("inventory.alerts")} value={inv.alerts.length} tone={inv.alerts.length ? "medium" : "ok"} />
      </div>

      <Section title={t("dash.atRisk")} actions={<Link href="/patients">{t("dash.patients")} →</Link>}>
        {atRisk.length === 0 ? (
          <p className="muted">{t("dash.noAtRisk")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("vitals.score")}</th>
                  <th>{t("dash.name")}</th>
                  <th>{t("patients.ward")}</th>
                  <th>{t("dash.when")}</th>
                  <th>{t("dash.recordedBy")}</th>
                  <th>{t("escalation.title")}</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((r) => (
                  <tr key={r.patient.id} className={`row-${r.latest!.mewsLevel}`}>
                    <td>
                      <MewsBadge total={r.latest!.mewsTotal} level={r.latest!.mewsLevel} complete={r.latest!.mewsComplete} />
                    </td>
                    <td>
                      <Link href={`/patients/${r.patient.id}`}>
                        {r.patient.givenName} {r.patient.familyName}
                      </Link>
                    </td>
                    <td>
                      {r.patient.ward}
                      {r.patient.bed ? ` · ${r.patient.bed}` : ""}
                    </td>
                    <td>
                      {fmtRelative(r.latest!.recordedAt)}
                      {(r.minutesOverdue ?? 0) > 0 && <span className="pill pill-medium"> {t("patients.overdue", { time: t("common.minutes", { n: r.minutesOverdue! }) })}</span>}
                    </td>
                    <td className="muted">{names.get(r.latest!.recordedBy) ?? "—"}</td>
                    <td>
                      {r.acknowledged ? <span className="pill pill-ok">{t("dash.acknowledged")}</span> : <span className="pill pill-high">{t("dash.unacknowledged")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid-2">
        <Section title={t("inventory.alerts")} actions={<Link href="/inventory">{t("dash.inventory")} →</Link>}>
          {inv.alerts.length === 0 ? (
            <p className="muted">{t("common.none")}</p>
          ) : (
            <ul className="list">
              {inv.alerts.slice(0, 12).map((a, i) => (
                <li key={i}>
                  <span>{itemName.get(a.itemId) ?? a.itemId}</span>
                  <span className={`pill ${a.kind === "expiring_soon" || a.kind === "low_stock" ? "pill-medium" : "pill-high"}`}>{describeStockAlert(t, a, fmtDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("dash.cabinets")}>
          {cabinets.length === 0 ? (
            <p className="muted">{t("common.none")}</p>
          ) : (
            <ul className="list">
              {cabinets.map((c) => {
                const last = c.events[0];
                const leftOpen = c.doorOpen && last && now - last.at.getTime() > LEFT_OPEN_MINUTES * 60_000;
                return (
                  <li key={c.id}>
                    <span>
                      {c.name}
                      {c.location ? <span className="muted"> · {c.location}</span> : null}
                    </span>
                    <span className={`pill ${leftOpen ? "pill-high" : c.doorOpen ? "pill-medium" : "pill-ok"}`}>
                      {leftOpen ? t("dash.door.left_open") : c.doorOpen ? t("dash.door.open") : t("dash.door.close")}
                      {last ? ` · ${fmtRelative(last.at)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title={t("dash.devices")} actions={<Link href="/admin">{t("dash.admin")} →</Link>}>
          {devices.length === 0 ? (
            <p className="muted">{t("common.none")}</p>
          ) : (
            <ul className="list">
              {devices.map((d) => (
                <li key={d.id}>
                  <span>{d.name}</span>
                  <span className={`pill ${staleDevices.includes(d) ? "pill-medium" : "pill-ok"}`}>
                    {d.lastSeenAt ? fmtRelative(d.lastSeenAt) : t("sync.never")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
