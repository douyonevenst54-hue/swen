/**
 * Stock is never stored as a number that gets overwritten. It is derived from
 * an append-only ledger of movements, so two devices that were offline can
 * both record dispenses and the totals still add up after sync.
 */
import type { StockMovement } from "./schemas";

export const MOVEMENT_SIGN: Record<StockMovement["type"], 1 | -1> = {
  receive: 1,
  transfer_in: 1,
  adjust_up: 1,
  dispense: -1,
  transfer_out: -1,
  adjust_down: -1,
  expire: -1,
  damage: -1,
};

export interface LotBalance {
  lot: string | null;
  expiryDate: string | null; // YYYY-MM-DD
  quantity: number;
}

export interface ItemStock {
  itemId: string;
  /** Everything on the books, including expired lots. */
  total: number;
  /** What can still be given to patients: excludes expired lots (needs `today`). */
  usable: number;
  lots: LotBalance[];
}

const lotKey = (lot: string | null | undefined, expiry: string | null | undefined) => `${lot ?? ""}|${expiry ?? ""}`;

/** Sum the ledger into per-item, per-lot balances. Movements may arrive in any order. */
export function computeStock(
  movements: Pick<StockMovement, "itemId" | "type" | "quantity" | "lot" | "expiryDate">[],
  today?: string,
): Map<string, ItemStock> {
  const byItem = new Map<string, Map<string, LotBalance>>();
  for (const m of movements) {
    let lots = byItem.get(m.itemId);
    if (!lots) byItem.set(m.itemId, (lots = new Map()));
    const key = lotKey(m.lot, m.expiryDate);
    let bal = lots.get(key);
    if (!bal) lots.set(key, (bal = { lot: m.lot ?? null, expiryDate: m.expiryDate ?? null, quantity: 0 }));
    bal.quantity += MOVEMENT_SIGN[m.type] * Math.abs(m.quantity);
  }
  const result = new Map<string, ItemStock>();
  for (const [itemId, lots] of byItem) {
    const list = [...lots.values()].filter((l) => l.quantity !== 0).sort(compareExpiry);
    const total = list.reduce((s, l) => s + l.quantity, 0);
    const expired = today ? list.filter((l) => l.expiryDate && l.expiryDate < today && l.quantity > 0).reduce((s, l) => s + l.quantity, 0) : 0;
    result.set(itemId, { itemId, total, usable: total - expired, lots: list });
  }
  return result;
}

function compareExpiry(a: LotBalance, b: LotBalance): number {
  if (a.expiryDate === b.expiryDate) return (a.lot ?? "").localeCompare(b.lot ?? "");
  if (a.expiryDate === null) return 1;
  if (b.expiryDate === null) return -1;
  return a.expiryDate.localeCompare(b.expiryDate);
}

/**
 * First-Expiry-First-Out: which lots to take `quantity` units from.
 * Expired lots are skipped. Returns the plan and any shortfall.
 */
export function planFefo(
  stock: ItemStock | undefined,
  quantity: number,
  today: string,
  opts: { expiredOnly?: boolean } = {},
): { take: { lot: string | null; expiryDate: string | null; quantity: number }[]; shortfall: number } {
  const take: { lot: string | null; expiryDate: string | null; quantity: number }[] = [];
  let remaining = quantity;
  for (const lot of stock?.lots ?? []) {
    if (remaining <= 0) break;
    if (lot.quantity <= 0) continue;
    const expired = !!lot.expiryDate && lot.expiryDate < today;
    // Removing expired stock takes only expired lots; everything else never does.
    if (expired !== !!opts.expiredOnly) continue;
    const n = Math.min(lot.quantity, remaining);
    take.push({ lot: lot.lot, expiryDate: lot.expiryDate, quantity: n });
    remaining -= n;
  }
  return { take, shortfall: Math.max(0, remaining) };
}

export type StockAlert =
  | { kind: "out_of_stock"; itemId: string }
  | { kind: "low_stock"; itemId: string; total: number; minStock: number }
  | { kind: "expired"; itemId: string; lot: string | null; expiryDate: string; quantity: number }
  | { kind: "expiring_soon"; itemId: string; lot: string | null; expiryDate: string; quantity: number; daysLeft: number }
  | { kind: "negative_balance"; itemId: string; total: number };

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function stockAlerts(
  items: { id: string; minStock: number; active?: boolean }[],
  stock: Map<string, ItemStock>,
  today: string,
  expiringWithinDays = 60,
): StockAlert[] {
  const alerts: StockAlert[] = [];
  for (const item of items) {
    if (item.active === false) continue;
    const s = stock.get(item.id);
    const total = s?.total ?? 0;
    // Expired units cannot be given to a patient, so they do not count as "in stock".
    const usable = s ? s.usable : 0;
    if (total < 0) alerts.push({ kind: "negative_balance", itemId: item.id, total });
    else if (usable <= 0) alerts.push({ kind: "out_of_stock", itemId: item.id });
    else if (usable <= item.minStock) alerts.push({ kind: "low_stock", itemId: item.id, total: usable, minStock: item.minStock });
    for (const lot of s?.lots ?? []) {
      if (!lot.expiryDate || lot.quantity <= 0) continue;
      const daysLeft = daysBetween(today, lot.expiryDate);
      if (daysLeft < 0) alerts.push({ kind: "expired", itemId: item.id, lot: lot.lot, expiryDate: lot.expiryDate, quantity: lot.quantity });
      else if (daysLeft <= expiringWithinDays)
        alerts.push({ kind: "expiring_soon", itemId: item.id, lot: lot.lot, expiryDate: lot.expiryDate, quantity: lot.quantity, daysLeft });
    }
  }
  const order: Record<StockAlert["kind"], number> = { negative_balance: 0, out_of_stock: 1, expired: 2, low_stock: 3, expiring_soon: 4 };
  return alerts.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Item QR labels encode "SWEN:ITEM:<code>". Plain codes (e.g. a GTIN barcode) are also accepted. */
export function parseItemCode(scanned: string): string {
  const trimmed = scanned.trim();
  const m = /^SWEN:ITEM:(.+)$/i.exec(trimmed);
  return m ? m[1]!.trim() : trimmed;
}

export function itemLabelPayload(code: string): string {
  return `SWEN:ITEM:${code}`;
}
