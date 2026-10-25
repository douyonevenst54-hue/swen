import { describe, expect, it } from "vitest";
import { computeStock, daysBetween, parseItemCode, planFefo, stockAlerts } from "../src/inventory";

const item = "11111111-1111-4111-8111-111111111111";
const m = (type: any, quantity: number, lot: string | null = null, expiryDate: string | null = null) => ({ itemId: item, type, quantity, lot, expiryDate });

describe("stock ledger", () => {
  it("sums movements per lot regardless of order", () => {
    const movements = [
      m("dispense", 3, "A", "2027-01-31"),
      m("receive", 10, "A", "2027-01-31"),
      m("receive", 5, "B", "2026-11-30"),
      m("expire", 1, "B", "2026-11-30"),
    ];
    const s = computeStock(movements).get(item)!;
    expect(s.total).toBe(11);
    // sorted by soonest expiry first
    expect(s.lots.map((l) => [l.lot, l.quantity])).toEqual([["B", 4], ["A", 7]]);
  });

  it("two offline devices dispensing both count", () => {
    const s = computeStock([m("receive", 10), m("dispense", 4), m("dispense", 4)]).get(item)!;
    expect(s.total).toBe(2);
  });

  it("FEFO picks soonest-expiring valid lots and skips expired ones", () => {
    const s = computeStock([
      m("receive", 5, "OLD", "2026-10-01"),
      m("receive", 3, "SOON", "2026-11-15"),
      m("receive", 10, "LATER", "2027-06-01"),
    ]).get(item);
    const plan = planFefo(s, 5, "2026-10-25");
    expect(plan.take).toEqual([
      { lot: "SOON", expiryDate: "2026-11-15", quantity: 3 },
      { lot: "LATER", expiryDate: "2027-06-01", quantity: 2 },
    ]);
    expect(plan.shortfall).toBe(0);
    expect(planFefo(s, 20, "2026-10-25").shortfall).toBe(7);
  });

  it("raises alerts in priority order", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const stock = computeStock([
      m("receive", 3, "X", "2026-11-10"),
      { itemId: other, type: "receive", quantity: 2, lot: "Y", expiryDate: "2026-09-01" },
    ], "2026-10-25");
    const alerts = stockAlerts(
      [
        { id: item, minStock: 5 },
        { id: other, minStock: 0 },
        { id: "33333333-3333-4333-8333-333333333333", minStock: 1 },
      ],
      stock,
      "2026-10-25",
    );
    // `other` only has expired units: it is out of stock for patients.
    expect(alerts.map((a) => a.kind)).toEqual(["out_of_stock", "out_of_stock", "expired", "low_stock", "expiring_soon"]);
  });

  it("separates usable stock from expired stock", () => {
    const s = computeStock([m("receive", 4, "OLD", "2026-09-30"), m("receive", 6, "NEW", "2027-03-31")], "2026-10-25").get(item)!;
    expect(s.total).toBe(10);
    expect(s.usable).toBe(6);
    // Removing expired stock takes only the expired lot.
    expect(planFefo(s, 10, "2026-10-25", { expiredOnly: true })).toEqual({ take: [{ lot: "OLD", expiryDate: "2026-09-30", quantity: 4 }], shortfall: 6 });
  });

  it("parses scanned codes", () => {
    expect(parseItemCode("SWEN:ITEM:GLOVE-M")).toBe("GLOVE-M");
    expect(parseItemCode(" 0123456789012 ")).toBe("0123456789012");
  });

  it("counts days across month ends", () => {
    expect(daysBetween("2026-10-25", "2026-11-01")).toBe(7);
  });
});
