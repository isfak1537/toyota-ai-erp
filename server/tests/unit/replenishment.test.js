const { computeReplenishment, selectSupplier, onOrderFor, ceilSafe } = require("../../src/modules/ai/replenishment");

const base = { dailyMean: 10, sigma: 3, leadTimeDays: 4, minimumOrderQty: 50, available: 40, onOrder: 0, z: 1.65, reviewDays: 7 };

describe("computeReplenishment (AI-004)", () => {
  it("matches the hand calculation: SS = 1.65*3*2 = 9.9, ROP = 49.9, qty = ceil(10*11 + 9.9 - 40) = 80", () => {
    const r = computeReplenishment(base);

    expect(r.safetyStock).toBeCloseTo(9.9, 10);
    expect(r.reorderPoint).toBeCloseTo(49.9, 10);
    expect(r.belowReorderPoint).toBe(true);
    expect(r.required).toBeCloseTo(79.9, 10);
    expect(r.suggestedQty).toBe(80);
    expect(r.outcome).toBe("SUGGEST");
  });

  it("raises the quantity to the minimum order quantity", () => {
    const r = computeReplenishment({ ...base, minimumOrderQty: 100 });

    expect(r.rawQty).toBe(80);
    expect(r.suggestedQty).toBe(100);
    expect(r.outcome).toBe("SUGGEST_MOQ");
  });

  it("suggests when available equals the reorder point exactly, and not one unit above", () => {
    const exact = { ...base, sigma: 0, leadTimeDays: 2, available: 20 }; // ROP = 10*2 = 20

    expect(computeReplenishment(exact).belowReorderPoint).toBe(true);
    expect(computeReplenishment(exact).suggestedQty).toBe(70); // ceil(10*9 - 20)
    expect(computeReplenishment({ ...exact, available: 21 })).toMatchObject({ belowReorderPoint: false, suggestedQty: null, outcome: "NOT_NEEDED" });
  });

  it("subtracts what is already on order", () => {
    const r = computeReplenishment({ ...base, onOrder: 30 });

    expect(r.suggestedQty).toBe(50); // ceil(79.9 - 30) = 50, equal to the MOQ
    expect(computeReplenishment({ ...base, onOrder: 25 }).suggestedQty).toBe(55);
  });

  it("makes no suggestion when the open orders cover the need, and says so", () => {
    const covered = computeReplenishment({ ...base, sigma: 0, leadTimeDays: 2, available: 15, onOrder: 80 }); // 90 - 15 - 80 = -5

    expect(covered).toMatchObject({ suggestedQty: null, outcome: "COVERED_BY_ON_ORDER" });
    expect(computeReplenishment({ ...base, sigma: 0, leadTimeDays: 2, available: 15, onOrder: 75 }).outcome).toBe("COVERED_BY_ON_ORDER"); // need exactly 0
    expect(computeReplenishment({ ...base, sigma: 0, leadTimeDays: 2, available: 15, onOrder: 74 }).suggestedQty).toBe(50); // need 1, MOQ 50
  });

  it("handles zero demand: nothing to suggest, and it is not mislabelled as covered", () => {
    const r = computeReplenishment({ ...base, dailyMean: 0, sigma: 0, available: 0 });

    expect(r).toMatchObject({ reorderPoint: 0, belowReorderPoint: true, suggestedQty: null, outcome: "NOT_NEEDED" });
  });

  it("does not let floating point noise add a unit", () => {
    expect(ceilSafe(12.000000000000002)).toBe(12);
    expect(ceilSafe(11.999999999999998)).toBe(12);
    expect(ceilSafe(12.000001)).toBe(13);
    expect(ceilSafe(-0.4)).toBe(-0);
  });

  it("uses the stored z and review days, not constants", () => {
    const a = computeReplenishment({ ...base, z: 1.28 });
    const b = computeReplenishment({ ...base, reviewDays: 14 });

    expect(a.safetyStock).toBeCloseTo(1.28 * 3 * 2, 10);
    expect(b.suggestedQty).toBe(150); // ceil(10*18 + 9.9 - 40) = 150
  });
});

describe("selectSupplier (AI-005)", () => {
  const opt = (supplierId, unitPrice, extra = {}) => ({ supplierId, unitPrice, isPreferred: false, supplier: { isActive: true }, ...extra });

  it("takes the preferred active supplier even when it is dearer", () => {
    const pick = selectSupplier([opt(1, "5.00"), opt(2, "9.00", { isPreferred: true })]);

    expect(pick).toMatchObject({ reason: "PREFERRED", option: { supplierId: 2 } });
  });

  it("falls back to the lowest price when the preferred supplier is inactive", () => {
    const pick = selectSupplier([opt(1, "5.00"), opt(2, "9.00", { isPreferred: true, supplier: { isActive: false } }), opt(3, "4.50")]);

    expect(pick).toMatchObject({ reason: "LOWEST_PRICE", option: { supplierId: 3 } });
  });

  it("breaks ties on the lowest supplier id, among preferred ones too", () => {
    expect(selectSupplier([opt(7, "5.00"), opt(3, "5.00")]).option.supplierId).toBe(3);
    expect(selectSupplier([opt(8, "5.00", { isPreferred: true }), opt(4, "6.00", { isPreferred: true })]).option.supplierId).toBe(8);
    expect(selectSupplier([opt(8, "5.00", { isPreferred: true }), opt(4, "5.00", { isPreferred: true })]).option.supplierId).toBe(4);
  });

  it("compares prices numerically, not as text", () => {
    expect(selectSupplier([opt(1, "10.00"), opt(2, "9.00")]).option.supplierId).toBe(2);
  });

  it("returns null when no active supplier exists", () => {
    expect(selectSupplier([])).toBeNull();
    expect(selectSupplier([opt(1, "5", { supplier: { isActive: false } })])).toBeNull();
  });
});

describe("onOrderFor (destination quantity and demand share)", () => {
  it("counts only the destination quantity when nothing is unaddressed", () => {
    expect(onOrderFor({ destinationQty: 40, unaddressedQty: 0, warehouseDaily: 2, productDaily: 5 })).toMatchObject({ onOrder: 40, exact: 40, method: "DESTINATION" });
  });

  it("shares unaddressed quantity by demand and floors it (never assume more stock is coming)", () => {
    const r = onOrderFor({ destinationQty: 0, unaddressedQty: 100, warehouseDaily: 3, productDaily: 7 });

    expect(r.exact).toBeCloseTo(42.857142, 5);
    expect(r).toMatchObject({ onOrder: 42, method: "DEMAND_SHARE", share: 3 / 7 });
  });

  it("combines both and names the method", () => {
    const r = onOrderFor({ destinationQty: 10, unaddressedQty: 10, warehouseDaily: 1, productDaily: 4 });

    expect(r).toMatchObject({ onOrder: 12, method: "DESTINATION+DEMAND_SHARE" }); // 10 + 2.5 -> 12
    expect(r.exact).toBeCloseTo(12.5, 10);
  });

  it("is NONE when there is nothing open, or no demand to share by", () => {
    expect(onOrderFor({ destinationQty: 0, unaddressedQty: 0, warehouseDaily: 1, productDaily: 1 })).toMatchObject({ onOrder: 0, method: "NONE" });
    expect(onOrderFor({ destinationQty: 0, unaddressedQty: 50, warehouseDaily: 0, productDaily: 0 })).toMatchObject({ onOrder: 0, method: "NONE", share: 0 });
  });

  it("shares of all warehouses never add up to more than the open quantity", () => {
    const daily = [3, 2, 2];
    const total = daily.reduce((a, b) => a + b, 0);
    const sum = daily.map((d) => onOrderFor({ destinationQty: 0, unaddressedQty: 100, warehouseDaily: d, productDaily: total }).onOrder).reduce((a, b) => a + b, 0);

    expect(sum).toBeLessThanOrEqual(100);
  });
});
