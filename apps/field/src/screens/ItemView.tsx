import { computeStock, DASHBOARD_ACTOR_ID, localDate, MOVEMENT_SIGN, MovementType, planFefo, type Item, type ItemStock, type MessageKey } from "@swen/core";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Banner, Field, TopBar } from "../app/components";
import { useApp, useSession } from "../app/store";
import { localDb, type MovementRow } from "../lib/db";
import { addMovements, listPatients, movementsFor, type LocalPatient } from "../lib/repo";
import { itemName } from "./Inventory";

type MType = (typeof MovementType.options)[number];
const QUICK: MType[] = ["dispense", "receive"];
const MORE: MType[] = ["adjust_up", "adjust_down", "expire", "damage", "transfer_in", "transfer_out"];

export function ItemView({ id }: { id: string }) {
  const { t, locale, dataVersion, changed, fmtTime, fmtDate, roster } = useApp();
  const session = useSession();
  const [item, setItem] = useState<Item | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [type, setType] = useState<MType>("dispense");
  const [qty, setQty] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [patientId, setPatientId] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([localDb().items.get(id), movementsFor(id), listPatients(session)]).then(([i, m, p]) => {
      setItem(i ?? null);
      setMovements(m);
      setPatients(p.sort((a, b) => a.familyName.localeCompare(b.familyName)));
    });
  }, [id, dataVersion, session]);

  const today = localDate(new Date());
  const stock: ItemStock | undefined = useMemo(() => computeStock(movements, today).get(id), [movements, id, today]);
  const quantity = Math.max(0, Math.floor(Number(qty) || 0));
  const outflow = MOVEMENT_SIGN[type] < 0;
  // For outflows `lot` holds the index of a chosen lot ("" = automatic).
  const chosenLot = outflow && lot !== "" ? stock?.lots[Number(lot)] : undefined;
  // Without a chosen lot: First-Expiry-First-Out; "remove expired" takes expired lots only.
  const plan = outflow && !chosenLot && quantity > 0 ? planFefo(stock, quantity, today, { expiredOnly: type === "expire" }) : null;
  const shortfall = plan ? plan.shortfall : chosenLot ? Math.max(0, quantity - chosenLot.quantity) : 0;
  // Only a count correction may take more than the books show (that is what it corrects).
  const blocked = shortfall > 0 && type !== "adjust_down";
  const who = (by: string) => (by === DASHBOARD_ACTOR_ID ? "Admin" : (roster.find((s) => s.id === by)?.name ?? "—"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item || quantity <= 0 || blocked) return;
    const base = { itemId: item.id, type, patientId: type === "dispense" && patientId ? patientId : null, note };
    let inputs;
    if (plan) {
      inputs = plan.take.map((p) => ({ ...base, quantity: p.quantity, lot: p.lot, expiryDate: p.expiryDate }));
      if (plan.shortfall > 0) inputs.push({ ...base, quantity: plan.shortfall, lot: null, expiryDate: null });
    } else if (chosenLot) {
      inputs = [{ ...base, quantity, lot: chosenLot.lot, expiryDate: chosenLot.expiryDate }];
    } else {
      inputs = [{ ...base, quantity, lot: lot.trim() || null, expiryDate: expiry || null }];
    }
    await addMovements(session, inputs);
    changed();
    setQty("");
    setLot("");
    setExpiry("");
    setNote("");
    setPatientId("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!item) return <TopBar title="…" backTo="/inventory" />;

  return (
    <>
      <TopBar title={itemName(item, locale)} sub={`${item.code} · ${item.unit}`} backTo="/inventory" />
      <main className="content narrow">
        <section className="stock-head">
          <div>
            <span className="stock-number">{stock?.usable ?? 0}</span>
            <span className="muted"> {item.unit}</span>
          </div>
          <span className="muted small">
            {t("inventory.minStock")}: {item.minStock}
          </span>
        </section>

        {(stock?.lots.length ?? 0) > 0 && (
          <section className="panel">
            <h2>{t("inventory.lots")}</h2>
            <ul className="lot-list">
              {stock!.lots.map((l, k) => {
                const expired = l.expiryDate && l.expiryDate < today;
                return (
                  <li key={k} className={expired ? "expired" : ""}>
                    <span>{l.lot ?? "—"}</span>
                    <span>{l.expiryDate ? fmtDate(l.expiryDate) : t("inventory.noExpiry")}</span>
                    <strong>{l.quantity}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <form className="panel stack" onSubmit={submit}>
          <div className="chips">
            {[...QUICK, ...MORE].map((m) => (
              <button type="button" key={m} className={type === m ? "on" : ""} onClick={() => {
                setType(m);
                setLot("");
              }}>
                {t(`inventory.movement.${m}` as MessageKey)}
              </button>
            ))}
          </div>
          <div className="grid-2">
            <Field label={t("inventory.quantity")}>
              <input className="num-input" inputMode="numeric" pattern="[0-9]*" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} required />
            </Field>
            {outflow ? (
              <Field label={t("inventory.lot")} hint={t("common.optional")}>
                <select value={lot} onChange={(e) => setLot(e.target.value)}>
                  <option value="">FEFO</option>
                  {stock?.lots.map((l, k) => (
                    <option key={k} value={String(k)}>
                      {l.lot ?? "—"} · {l.expiryDate ?? "—"} · {l.quantity}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={t("inventory.lot")} hint={t("common.optional")}>
                <input value={lot} onChange={(e) => setLot(e.target.value)} maxLength={60} />
              </Field>
            )}
          </div>
          {!outflow && (
            <Field label={t("inventory.expiry")} hint={t("common.optional")}>
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </Field>
          )}
          {type === "dispense" && (
            <Field label={t("inventory.forPatient")} hint={t("common.optional")}>
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">—</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.familyName} {p.givenName} · {p.ward}
                    {p.bed ? ` ${p.bed}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("vitals.note")} hint={t("common.optional")}>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          {plan?.take[0] && <Banner tone="info">{t("inventory.fefo", { lot: plan.take[0].lot ?? "—", date: plan.take[0].expiryDate ? fmtDate(plan.take[0].expiryDate) : "—" })}</Banner>}
          {shortfall > 0 && <Banner tone={blocked ? "danger" : "warn"}>{t("inventory.shortfall", { n: quantity - shortfall })}</Banner>}
          {saved && <Banner tone="ok">{t("inventory.saved")}</Banner>}
          <button className="btn btn-primary btn-lg" disabled={quantity <= 0 || blocked}>
            {t(`inventory.movement.${type}` as MessageKey)}
          </button>
        </form>

        <section className="panel">
          <h2>{t("inventory.history")}</h2>
          <ul className="move-list">
            {movements.slice(0, 50).map((m) => (
              <li key={m.id}>
                <span className={MOVEMENT_SIGN[m.type] > 0 ? "in" : "out"}>
                  {MOVEMENT_SIGN[m.type] > 0 ? "+" : "−"}
                  {m.quantity}
                </span>
                <span>
                  {t(`inventory.movement.${m.type}` as MessageKey)}
                  {m.lot ? ` · ${m.lot}` : ""}
                  <small>
                    {fmtTime(m.at)} · {who(m.by)}
                    {m.dirty === 1 ? " · ↻" : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
