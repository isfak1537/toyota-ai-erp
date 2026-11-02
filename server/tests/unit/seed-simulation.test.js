const { buildDataset } = require("../../prisma/seed/build");

const AFFECTS_ON_HAND = new Set(["RECEIPT", "ISSUE", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"]);

const dataset = buildDataset();
const bySeries = new Map();

for (const row of dataset.ledger) {
  const key = `${row.sku}@${row.warehouseCode}`;
  if (!bySeries.has(key)) bySeries.set(key, []);
  bySeries.get(key).push(row);
}

const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
const dateOf = (iso) => iso.slice(0, 10);

describe("determinism (SEED-006, NFR-016)", () => {
  it("same seed and end date give identical data", () => {
    expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(buildDataset()));
  });

  it("a different seed gives different data, a different end date shifts it", () => {
    const other = buildDataset({ seed: 7 });
    const later = buildDataset({ endDate: "2026-12-01" });

    expect(JSON.stringify(other.ledger)).not.toBe(JSON.stringify(dataset.ledger));
    expect(later.meta.startDate).not.toBe(dataset.meta.startDate);
    expect(later.ledger[0].createdAt > dataset.ledger[0].createdAt).toBe(true);
  });

  it("does not depend on the clock or Math.random", () => {
    const realRandom = Math.random;
    const realNow = Date.now;
    Math.random = () => {
      throw new Error("Math.random used");
    };
    Date.now = () => {
      throw new Error("Date.now used");
    };

    try {
      expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(dataset));
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
  });
});

describe("ledger consistency (SEED-005)", () => {
  it("is written in chronological order", () => {
    for (let i = 1; i < dataset.ledger.length; i += 1) {
      expect(dataset.ledger[i].createdAt >= dataset.ledger[i - 1].createdAt).toBe(true);
    }
  });

  it("is back-dated inside the 90-day window ending on the end date", () => {
    const first = dataset.ledger[0].createdAt;
    const last = dataset.ledger[dataset.ledger.length - 1].createdAt;

    expect(dateOf(first) >= dataset.meta.startDate).toBe(true);
    expect(dateOf(last) <= dataset.meta.endDate).toBe(true);
    expect(dataset.meta.days).toBe(90);
    expect(new Set(dataset.ledger.map((r) => dateOf(r.createdAt))).size).toBeGreaterThanOrEqual(85);
  });

  it("every series starts from zero and each balanceAfter follows from the previous one", () => {
    for (const [key, rows] of bySeries) {
      let balance = 0;

      for (const row of rows) {
        if (AFFECTS_ON_HAND.has(row.type)) balance += row.quantity;

        if (row.balanceAfter !== balance) {
          throw new Error(`${key} ${row.createdAt} ${row.type}: balanceAfter ${row.balanceAfter}, expected ${balance}`);
        }
        expect(row.balanceAfter).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reservations and releases do not move on-hand stock", () => {
    dataset.ledger
      .filter((r) => r.type === "RESERVATION" || r.type === "RELEASE")
      .forEach((r) => expect(r.quantity).toBe(0));
  });

  it("final inventory equals the last ledger balance and respects 0 <= reserved <= quantity", () => {
    expect(dataset.inventory).toHaveLength(bySeries.size);

    for (const inv of dataset.inventory) {
      const rows = bySeries.get(`${inv.sku}@${inv.warehouseCode}`);

      expect(inv.quantity).toBe(rows[rows.length - 1].balanceAfter);
      expect(inv.reservedQuantity).toBeGreaterThanOrEqual(0);
      expect(inv.reservedQuantity).toBeLessThanOrEqual(inv.quantity);
    }
  });

  it("reserved quantity (rebuilt from the ledger reasons) never exceeds on-hand at any step", () => {
    for (const [key, rows] of bySeries) {
      let reserved = 0;

      for (const row of rows) {
        const match = /(Reserved|Released) (\d+) units/.exec(row.reason ?? "");

        if (match) reserved += (match[1] === "Reserved" ? 1 : -1) * Number(match[2]);

        if (reserved < 0 || reserved > row.balanceAfter) {
          throw new Error(`${key} ${row.createdAt}: reserved ${reserved} vs on-hand ${row.balanceAfter}`);
        }
      }

      const inv = dataset.inventory.find((i) => `${i.sku}@${i.warehouseCode}` === key);
      expect(reserved).toBe(inv.reservedQuantity);
    }
  });

  it("keeps normal activity inside business hours (08:00-17:00 UTC+6 = 02:00-11:00 UTC)", () => {
    dataset.ledger
      .filter((r) => r.anomalyId === null)
      .forEach((r) => {
        const hour = new Date(r.createdAt).getUTCHours();

        if (hour < 2 || hour >= 11) throw new Error(`${r.sku} ${r.type} at ${r.createdAt}`);
      });
  });
});

describe("demand (SEED-002)", () => {
  const issues = dataset.ledger.filter((r) => r.type === "ISSUE");

  it("is lower on Friday and Saturday than on the other days", () => {
    const perDay = new Map();
    issues.forEach((r) => perDay.set(dateOf(r.createdAt), (perDay.get(dateOf(r.createdAt)) ?? 0) - r.quantity));

    const mean = (days) => days.reduce((a, b) => a + b, 0) / days.length;
    const weekend = [];
    const workdays = [];

    for (const [date, total] of perDay) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      (dow === 5 || dow === 6 ? weekend : workdays).push(total);
    }

    expect(mean(weekend) / mean(workdays)).toBeLessThan(0.8);
    expect(mean(weekend) / mean(workdays)).toBeGreaterThan(0.35);
  });

  it("trends up for the trending products and stays flat for stable ones", () => {
    const half = dataset.meta.startDate;
    const midpoint = new Date(`${half}T00:00:00Z`).getTime() + 45 * 86400000;
    const demand = (profile, period) => {
      const skus = new Set(dataset.products.filter((p) => p.profile === profile).map((p) => p.sku));

      return -sum(
        issues.filter(
          (r) =>
            skus.has(r.sku) &&
            r.warehouseCode === "SYN-MAIN" &&
            (period === "first" ? new Date(r.createdAt).getTime() < midpoint : new Date(r.createdAt).getTime() >= midpoint)
        ),
        (r) => r.quantity
      );
    };

    expect(demand("TRENDING", "second") / demand("TRENDING", "first")).toBeGreaterThan(1.2);
    const stable = demand("STABLE", "second") / demand("STABLE", "first");
    expect(stable).toBeGreaterThan(0.8);
    expect(stable).toBeLessThan(1.25);
  });

  it("leaves days without issues empty, so a daily series has genuine zeros", () => {
    const series = issues.filter((r) => r.sku === "SYN-ENG-006" && r.warehouseCode === "SYN-MAIN");
    const days = new Set(series.map((r) => dateOf(r.createdAt)));

    expect(days.size).toBeLessThan(90);
    expect(days.size).toBeGreaterThan(10);
  });
});

describe("replenishment history (SEED-003)", () => {
  it("links every receipt to a received purchase order from the preferred or alternate supplier", () => {
    const poByNumber = new Map(dataset.purchaseOrders.map((po) => [po.number, po]));

    expect(dataset.goodsReceipts.length).toBeGreaterThan(40);

    for (const receipt of dataset.goodsReceipts) {
      const po = poByNumber.get(receipt.purchaseOrderNumber);

      expect(po.status).toBe("RECEIVED");
      expect(po.item.sku).toBe(receipt.sku);
      expect(po.item.quantity).toBe(receipt.quantity);
      expect(po.item.receivedQuantity).toBe(po.item.quantity);
    }
  });

  it("receives goods after the supplier lead time", () => {
    const leadOf = new Map(dataset.supplierProducts.map((s) => [`${s.supplierCode}|${s.sku}`, s.leadTimeDays]));
    const poByNumber = new Map(dataset.purchaseOrders.map((po) => [po.number, po]));

    for (const receipt of dataset.goodsReceipts) {
      const po = poByNumber.get(receipt.purchaseOrderNumber);
      const lead = leadOf.get(`${po.supplierCode}|${po.item.sku}`);
      const days = (Date.parse(receipt.receivedAt) - Date.parse(po.createdAt)) / 86400000;

      expect(days).toBeGreaterThanOrEqual(lead - 1);
      expect(days).toBeLessThanOrEqual(lead + 2.5);
    }
  });

  it("leaves some purchase orders in flight (onOrder for AI-004)", () => {
    const open = dataset.purchaseOrders.filter((po) => po.status === "APPROVED");

    open.forEach((po) => expect(po.item.receivedQuantity).toBe(0));
    expect(open.length).toBeGreaterThanOrEqual(1);
  });

  it("computes PO money exactly with decimals", () => {
    for (const po of dataset.purchaseOrders) {
      const line = Number(po.item.quantity) * Number(po.item.unitPrice);

      expect(Math.abs(Number(po.item.lineTotal) - line)).toBeLessThan(0.0051);
      expect(po.subtotal).toBe(po.item.lineTotal);
      expect(Number(po.totalAmount)).toBeCloseTo(Number(po.subtotal) + Number(po.taxAmount), 2);
      expect(po.totalAmount).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("numbers purchase orders, receipts and transfers uniquely", () => {
    expect(new Set(dataset.purchaseOrders.map((p) => p.number)).size).toBe(dataset.purchaseOrders.length);
    expect(new Set(dataset.goodsReceipts.map((g) => g.number)).size).toBe(dataset.goodsReceipts.length);
    expect(new Set(dataset.transfers.map((t) => t.number)).size).toBe(dataset.transfers.length);
  });

  it("every ledger reference resolves to a document", () => {
    const receipts = new Set(dataset.goodsReceipts.map((g) => g.number));
    const transfers = new Set(dataset.transfers.map((t) => t.number));

    for (const row of dataset.ledger) {
      if (row.reference?.type === "GOODS_RECEIPT") expect(receipts.has(row.reference.number)).toBe(true);
      if (row.reference?.type === "STOCK_TRANSFER") expect(transfers.has(row.reference.number)).toBe(true);
    }

    expect(dataset.ledger.filter((r) => r.type === "RECEIPT").every((r) => r.reference || r.anomalyId)).toBe(true);
  });
});

describe("transfers between the two warehouses", () => {
  it("has six, each with matching OUT and IN ledger rows at the same moment", () => {
    expect(dataset.transfers).toHaveLength(6);

    for (const transfer of dataset.transfers) {
      const rows = dataset.ledger.filter((r) => r.reference?.number === transfer.number);
      const out = rows.find((r) => r.type === "TRANSFER_OUT");
      const inn = rows.find((r) => r.type === "TRANSFER_IN");

      expect(out.warehouseCode).toBe("SYN-MAIN");
      expect(inn.warehouseCode).toBe("SYN-DEPOT");
      expect(out.quantity).toBe(-transfer.quantity);
      expect(inn.quantity).toBe(transfer.quantity);
      expect(out.createdAt).toBe(inn.createdAt);
    }
  });
});
