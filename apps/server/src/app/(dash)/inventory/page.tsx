import { describeStockAlert, MovementType, type MessageKey } from "@swen/core";
import Link from "next/link";
import { createItem, recordMovement, toggleItem, updateItemMin } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { Section } from "@/components/ui";
import { db } from "@/lib/db";
import { currentFacility } from "@/lib/facility";
import { getI18n } from "@/lib/locale";
import { inventoryView } from "@/lib/queries";

export default async function InventoryPage() {
  const { t, fmtDate, locale } = await getI18n();
  const { facility } = await currentFacility();
  if (!facility) return null;
  const { items, stock, alerts } = await inventoryView(db(), facility.id);
  const alertsByItem = new Map<string, typeof alerts>();
  for (const a of alerts) alertsByItem.set(a.itemId, [...(alertsByItem.get(a.itemId) ?? []), a]);
  const name = (i: { nameHt: string; nameFr: string }) => (locale === "fr" ? i.nameFr : i.nameHt);

  return (
    <>
      <div className="page-head">
        <h1>{t("dash.inventory")}</h1>
        <Link className="btn btn-secondary" href="/inventory/labels">
          {t("dash.printLabels")}
        </Link>
      </div>

      <Section title={t("dash.items")}>
        {items.length === 0 ? (
          <p className="muted">{t("inventory.empty")}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("dash.code")}</th>
                  <th>{t("dash.name")}</th>
                  <th>{t("dash.category")}</th>
                  <th className="num">{t("inventory.stock")}</th>
                  <th>{t("inventory.lots")}</th>
                  <th>{t("inventory.minStock")}</th>
                  <th>{t("inventory.alerts")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const s = stock.get(i.id);
                  const itemAlerts = alertsByItem.get(i.id) ?? [];
                  return (
                    <tr key={i.id} className={i.active ? "" : "muted"}>
                      <td>
                        <code>{i.code}</code>
                      </td>
                      <td>
                        {name(i)} <span className="muted small">({i.unit})</span>
                      </td>
                      <td>{i.category ?? "—"}</td>
                      <td className="num">
                        <strong>{s?.total ?? 0}</strong>
                      </td>
                      <td className="small">
                        {(s?.lots ?? []).map((l, k) => (
                          <div key={k}>
                            {l.lot ?? "—"} · {l.expiryDate ? fmtDate(l.expiryDate) : t("inventory.noExpiry")} · {l.quantity}
                          </div>
                        ))}
                      </td>
                      <td>
                        <form action={updateItemMin} className="inline">
                          <input type="hidden" name="itemId" value={i.id} />
                          <input type="number" name="minStock" min={0} defaultValue={i.minStock} aria-label={t("inventory.minStock")} />
                          <button className="btn btn-secondary" type="submit">
                            ✓
                          </button>
                        </form>
                      </td>
                      <td className="small">
                        {itemAlerts.map((a, k) => (
                          <div key={k} className={`pill ${a.kind === "expiring_soon" || a.kind === "low_stock" ? "pill-medium" : "pill-high"}`}>
                            {describeStockAlert(t, a, fmtDate)}
                          </div>
                        ))}
                      </td>
                      <td>
                        <form action={toggleItem}>
                          <input type="hidden" name="itemId" value={i.id} />
                          <button className="btn btn-secondary" type="submit">
                            {i.active ? t("dash.deactivate") : t("dash.activate")}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid-2">
        <Section title={t("dash.receiveStock")}>
          <ActionForm action={recordMovement} submitLabel={t("common.save")}>
            <label>
              {t("dash.items")}
              <select name="itemId" required>
                {items
                  .filter((i) => i.active)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {name(i)} ({i.code})
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                {t("inventory.quantity")}
                <input type="number" name="quantity" min={1} required />
              </label>
              <label>
                {t("inventory.movementType")}
                <select name="type" defaultValue="receive">
                  {MovementType.options.map((m) => (
                    <option key={m} value={m}>
                      {t(`inventory.movement.${m}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                {t("inventory.lot")} <span className="muted">({t("common.optional")})</span>
                <input name="lot" maxLength={60} />
              </label>
              <label>
                {t("inventory.expiry")} <span className="muted">({t("common.optional")})</span>
                <input type="date" name="expiryDate" />
              </label>
            </div>
            <label>
              {t("vitals.note")} <span className="muted">({t("common.optional")})</span>
              <input name="note" maxLength={500} />
            </label>
          </ActionForm>
        </Section>

        <Section title={t("dash.addItem")}>
          <ActionForm action={createItem} submitLabel={t("common.add")}>
            <div className="form-row">
              <label>
                {t("dash.code")}
                <input name="code" required maxLength={64} placeholder="GLOVE-M" />
              </label>
              <label>
                {t("dash.unit")}
                <input name="unit" required maxLength={30} placeholder="pè / paire" />
              </label>
            </div>
            <div className="form-row">
              <label>
                {t("dash.nameHt")}
                <input name="nameHt" required maxLength={120} />
              </label>
              <label>
                {t("dash.nameFr")}
                <input name="nameFr" required maxLength={120} />
              </label>
            </div>
            <div className="form-row">
              <label>
                {t("dash.category")} <span className="muted">({t("common.optional")})</span>
                <input name="category" maxLength={60} />
              </label>
              <label>
                {t("inventory.minStock")}
                <input type="number" name="minStock" min={0} defaultValue={0} required />
              </label>
            </div>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
