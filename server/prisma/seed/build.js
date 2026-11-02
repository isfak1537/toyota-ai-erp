// Builds the complete synthetic dataset in memory (no database access). The
// writer in writer.js turns it into rows; the tests inspect it directly.
const { Prisma } = require("@prisma/client");
const { Rng } = require("./prng");
const {
  DAY_MS,
  SEED_DEFAULT,
  END_DATE_DEFAULT,
  DAYS,
  TZ_OFFSET_HOURS,
  parseEndDate,
} = require("./config");
const { company, factory, warehouses, categories, suppliers, buildProducts } = require("./catalog");
const { simulateSeries, at, businessMinute } = require("./simulate");

const { Decimal } = Prisma;
const MAIN = warehouses[0].code;
const DEPOT = warehouses[1].code;
const TAX_RATE = "0.05";

const pad = (n, width = 4) => String(n).padStart(width, "0");

const money = (decimal) => decimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

const seriesRng = (seed, sku, warehouseCode) => new Rng(seed, "series", sku, warehouseCode);

// SEED-007 demo scenarios. Steered series stop reordering a few weeks before
// the end and the demand of the last 12 days is planned so that the available
// stock lands on the target; the overstock product makes one bulk purchase.
const STEER_WINDOW_START = 78;

const scenarioFor = (product) => {
  const lead = product.supplierOptions[0].leadTimeDays;

  switch (product.profile) {
    case "NEAR_ROP":
      return {
        reservationRate: 0,
        steer: {
          suspendFromDay: 67,
          windowStart: STEER_WINDOW_START,
          target: Math.max(2, Math.round(product.ropRatio * product.reorderLevel)),
        },
      };
    case "TREND_FAST":
      // less than half the lead time of cover at the demand rate of the end
      return {
        reservationRate: 0,
        steer: {
          suspendFromDay: 72,
          windowStart: STEER_WINDOW_START,
          target: Math.max(2, Math.ceil(0.4 * lead * product.base * (1 + product.trend) * 0.9)),
        },
      };
    case "OVERSTOCKED":
      return { bulk: { day: 66, coverDays: 120 } };
    default:
      return {};
  }
};

// Parameters of every product x warehouse series.
const seriesPlan = (products) => {
  const plan = [];

  for (const product of products) {
    plan.push({
      product,
      warehouseCode: MAIN,
      base: product.base,
      rop: product.reorderLevel,
      orderUpTo: product.orderUpTo,
      reservationRate: 0.05,
      ...scenarioFor(product),
    });

    if (product.inDepot) {
      // the depot holds a buffer above the product-level reorder point, so its
      // rows never show up as low stock on the dashboard
      const base = Math.max(0.4, Math.round(product.base * 0.35 * 100) / 100);
      const avg = base * (1 + product.trend / 2);
      const rop = Math.ceil(product.reorderLevel * 1.15);

      plan.push({
        product,
        warehouseCode: DEPOT,
        base,
        rop,
        orderUpTo: rop + Math.ceil(14 * avg),
        reservationRate: 0.03,
      });
    }
  }

  return plan;
};

const simulateAll = ({ seed, start0, products, injectionsBySeries = {} }) => {
  const plan = seriesPlan(products);

  // one A->B transfer per depot product, planned up front
  const transferRng = new Rng(seed, "transfers");
  const transferPlans = products
    .filter((product) => product.inDepot)
    .map((product) => ({
      id: `T:${product.sku}`,
      sku: product.sku,
      day: transferRng.int(15, 80),
      plannedQty: Math.max(5, Math.round(product.base * 0.35 * 10)),
    }));

  const run = (item, extra) =>
    simulateSeries({
      rng: seriesRng(seed, item.product.sku, item.warehouseCode),
      sku: item.product.sku,
      warehouseCode: item.warehouseCode,
      start0,
      days: DAYS,
      base: item.base,
      trend: item.product.trend,
      rop: item.rop,
      orderUpTo: item.orderUpTo,
      options: item.product.supplierOptions,
      openingQty: item.orderUpTo,
      reservationRate: item.reservationRate,
      steer: item.steer ?? null,
      bulk: item.bulk ?? null,
      injections: injectionsBySeries[`${item.product.sku}@${item.warehouseCode}`] ?? [],
      ...extra,
    });

  const results = new Map();

  // main warehouse first: its transfers out decide what the depot receives
  for (const item of plan.filter((p) => p.warehouseCode === MAIN)) {
    const transfersOut = transferPlans
      .filter((t) => t.sku === item.product.sku)
      .map((t) => ({ id: t.id, day: t.day, plannedQty: t.plannedQty }));

    results.set(`${item.product.sku}@${MAIN}`, { item, ...run(item, { transfersOut }) });
  }

  for (const item of plan.filter((p) => p.warehouseCode === DEPOT)) {
    const out = results.get(`${item.product.sku}@${MAIN}`).transferOuts;
    const transfersIn = out.map((t) => ({ id: t.id, ts: t.ts, quantity: t.quantity }));

    results.set(`${item.product.sku}@${DEPOT}`, { item, ...run(item, { transfersIn }) });
  }

  return results;
};

// SEED-004: eight injected anomalies on main-warehouse series that are neither
// steered nor part of a transfer. The three newest fall in the last ten days so
// they are visible in the demo. Days are chosen from a first, un-injected run
// so the stock can actually bear the event.
const ANOMALY_PLAN = [
  { id: "A-01", type: "SPIKE_ISSUE", sku: "SYN-ELE-005", window: [84, 88] },
  { id: "A-02", type: "NEGATIVE_ADJUSTMENT", sku: "SYN-BRK-004", window: [82, 86] },
  { id: "A-03", type: "OFF_HOURS_ISSUE", sku: "SYN-ENG-006", window: [80, 85] },
  { id: "A-04", type: "NEGATIVE_ADJUSTMENT", sku: "SYN-BRK-006", window: [20, 35] },
  { id: "A-05", type: "SPIKE_ISSUE", sku: "SYN-ELE-002", window: [40, 55] },
  { id: "A-06", type: "DUPLICATE_ISSUE", sku: "SYN-BRK-003", window: [55, 68] },
  { id: "A-07", type: "MANUAL_RECEIPT", sku: "SYN-ENG-006", window: [30, 45] },
  { id: "A-08", type: "OFF_HOURS_ISSUE", sku: "SYN-ELE-005", window: [10, 25] },
];

const DETECTION = {
  SPIKE_ISSUE: { expectedDetection: "BOTH", severity: "HIGH", description: "Issue far above the product's normal daily demand" },
  NEGATIVE_ADJUSTMENT: { expectedDetection: "RULE", severity: "HIGH", description: "Large negative stock adjustment" },
  OFF_HOURS_ISSUE: { expectedDetection: "RULE", severity: "MEDIUM", description: "Stock issue outside business hours (01:00-04:00 local)" },
  DUPLICATE_ISSUE: { expectedDetection: "MODEL", severity: "MEDIUM", description: "Same issue repeated within minutes" },
  MANUAL_RECEIPT: { expectedDetection: "BOTH", severity: "MEDIUM", description: "Large manual receipt without a purchase order" },
};

const planInjections = ({ seed, start0, products, baseline }) => {
  const bySeries = {};

  for (const entry of ANOMALY_PLAN) {
    const product = products.find((p) => p.sku === entry.sku);
    const snapshot = baseline.get(`${entry.sku}@${MAIN}`).daily;
    const rng = new Rng(seed, "anomaly", entry.id);
    const avail = (d) => snapshot[d].onHand - snapshot[d].reserved;
    const lambda = (d) => product.base * (1 + product.trend * (d / (DAYS - 1)));

    const spec = (d) => {
      const before = avail(Math.max(0, d - 1));
      const now = avail(d);
      const room = Math.min(before, now);

      switch (entry.type) {
        case "SPIKE_ISSUE": {
          const quantity = Math.max(6, Math.round(9 * lambda(d)));
          return room >= Math.ceil(quantity * 1.3) ? { quantity, minute: businessMinute(rng) } : null;
        }
        case "NEGATIVE_ADJUSTMENT": {
          const quantity = Math.max(5, Math.round(0.3 * before));
          return room >= Math.ceil(quantity * 1.3) ? { quantity, minute: businessMinute(rng) } : null;
        }
        case "OFF_HOURS_ISSUE": {
          const quantity = Math.max(1, Math.round(1.5 * lambda(d)));
          return room >= quantity * 3 ? { quantity, minute: 19 * 60 + rng.int(0, 3 * 60 - 1) } : null;
        }
        case "DUPLICATE_ISSUE": {
          const quantity = Math.max(1, Math.round(1.2 * lambda(d)));
          return room >= quantity * 4 ? { quantity, minute: businessMinute(rng) } : null;
        }
        case "MANUAL_RECEIPT":
          return { quantity: Math.ceil(product.orderUpTo * 0.8), minute: businessMinute(rng) };
        default:
          throw new Error(`Unknown anomaly type ${entry.type}`);
      }
    };

    const inWindow = rng.shuffle(
      Array.from({ length: entry.window[1] - entry.window[0] + 1 }, (_, i) => entry.window[0] + i)
    );
    const elsewhere = Array.from({ length: DAYS - 8 }, (_, i) => i + 4).filter(
      (d) => d < entry.window[0] || d > entry.window[1]
    );

    let chosen = null;

    for (const d of [...inWindow, ...elsewhere]) {
      const found = spec(d);

      if (found) {
        chosen = { id: entry.id, type: entry.type, day: d, ...found };
        break;
      }
    }

    if (!chosen) {
      throw new Error(`No feasible day for anomaly ${entry.id}`);
    }

    const key = `${entry.sku}@${MAIN}`;
    (bySeries[key] ??= []).push(chosen);
  }

  return bySeries;
};

const buildLabels = ({ ledger, seed, endDate }) => {
  const rows = ledger.filter((row) => row.anomalyId !== null);
  const ids = [...new Set(rows.map((row) => row.anomalyId))].sort();
  const lastDay = new Date(`${endDate}T00:00:00Z`).getTime();

  const natural = (row) => ({
    sku: row.sku,
    warehouseCode: row.warehouseCode,
    occurredAt: row.createdAt,
    ledgerType: row.type,
    quantity: row.quantity,
  });

  return {
    description:
      "Ground truth for the anomalies injected by prisma/seed/generate.js. Rows are identified by their natural key (sku, warehouseCode, occurredAt, ledgerType, quantity) because database ids are not stable.",
    seed,
    endDate,
    timezoneOffsetHours: TZ_OFFSET_HOURS,
    businessHoursUtc: "02:00-11:00",
    count: ids.length,
    anomalies: ids.map((id) => {
      const group = rows.filter((row) => row.anomalyId === id);
      const target = group.find((row) => row.anomalyRole === "duplicate") ?? group[0];
      const original = group.find((row) => row.anomalyRole === "original");
      const entry = ANOMALY_PLAN.find((plan) => plan.id === id);
      const daysBeforeEnd = Math.floor((lastDay + 86400000 - Date.parse(target.createdAt)) / 86400000);

      return {
        id,
        anomalyType: entry.type,
        ...natural(target),
        balanceAfter: target.balanceAfter,
        ...DETECTION[entry.type],
        visibleInDemo: daysBeforeEnd <= 10,
        related: original ? natural(original) : null,
      };
    }),
  };
};

const buildDataset = ({ seed = SEED_DEFAULT, endDate = END_DATE_DEFAULT } = {}) => {
  const endMs = parseEndDate(endDate);
  const start0 = endMs - (DAYS - 1) * DAY_MS;
  const products = buildProducts();
  const baseline = simulateAll({ seed, start0, products });
  const injectionsBySeries = planInjections({ seed, start0, products, baseline });
  const results = simulateAll({ seed, start0, products, injectionsBySeries });
  const series = [...results.values()];

  // purchase orders and goods receipts, numbered chronologically
  const orders = series
    .flatMap((s) => s.orders)
    .sort(
      (a, b) =>
        a.createdMs - b.createdMs ||
        a.warehouseCode.localeCompare(b.warehouseCode) ||
        a.sku.localeCompare(b.sku) ||
        a.id.localeCompare(b.id)
    );

  const poNumber = new Map(orders.map((order, i) => [order.id, `PO-SYN-${pad(i + 1)}`]));
  const received = orders
    .filter((order) => order.receivedMs !== null)
    .sort((a, b) => a.receivedMs - b.receivedMs || a.id.localeCompare(b.id));
  const receiptNumber = new Map(received.map((order, i) => [order.id, `GR-SYN-${pad(i + 1)}`]));

  const purchaseOrders = orders.map((order) => {
    const lineTotal = new Decimal(order.quantity).times(order.unitPrice);
    const taxAmount = lineTotal.times(TAX_RATE);

    return {
      number: poNumber.get(order.id),
      supplierCode: order.supplierCode,
      status: order.receivedMs === null ? "APPROVED" : "RECEIVED",
      createdAt: new Date(order.createdMs).toISOString(),
      expectedAt: new Date(order.createdMs + order.leadTimeDays * DAY_MS).toISOString(),
      notes: order.notes,
      subtotal: money(lineTotal),
      taxAmount: money(taxAmount),
      totalAmount: money(lineTotal.plus(money(taxAmount))),
      item: {
        sku: order.sku,
        quantity: order.quantity,
        receivedQuantity: order.receivedMs === null ? 0 : order.quantity,
        unitPrice: order.unitPrice,
        lineTotal: money(lineTotal),
      },
      receivingWarehouseCode: order.warehouseCode,
    };
  });

  const goodsReceipts = received.map((order) => ({
    number: receiptNumber.get(order.id),
    purchaseOrderNumber: poNumber.get(order.id),
    warehouseCode: order.warehouseCode,
    receivedAt: new Date(order.receivedMs).toISOString(),
    sku: order.sku,
    quantity: order.quantity,
  }));

  // transfers (one item each), numbered chronologically
  const transferOuts = series
    .filter((s) => s.item.warehouseCode === MAIN)
    .flatMap((s) => s.transferOuts.map((t) => ({ ...t, sku: s.item.product.sku })))
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const transferNumber = new Map(transferOuts.map((t, i) => [t.id, `TRF-SYN-${pad(i + 1, 3)}`]));

  const transfers = transferOuts.map((t) => ({
    number: transferNumber.get(t.id),
    fromWarehouseCode: MAIN,
    toWarehouseCode: DEPOT,
    createdAt: new Date(t.ts).toISOString(),
    sku: t.sku,
    quantity: t.quantity,
  }));

  // the ledger, written in chronological order
  const refNumber = (ref) => {
    if (!ref) {
      return null;
    }

    return ref.kind === "ORDER"
      ? { type: "GOODS_RECEIPT", number: receiptNumber.get(ref.id) }
      : { type: "STOCK_TRANSFER", number: transferNumber.get(ref.id) };
  };

  const ledger = series
    .flatMap((s) => s.events)
    .sort(
      (a, b) =>
        a.ts - b.ts ||
        a.warehouseCode.localeCompare(b.warehouseCode) ||
        a.sku.localeCompare(b.sku)
    )
    .map((event) => ({
      sku: event.sku,
      warehouseCode: event.warehouseCode,
      type: event.type,
      quantity: event.quantity,
      balanceAfter: event.balanceAfter,
      createdAt: new Date(event.ts).toISOString(),
      referenceType: event.referenceType,
      reference: refNumber(event.ref),
      reason: event.reason,
      anomalyId: event.anomalyId,
      anomalyRole: event.anomalyRole,
    }));

  const inventory = series.map((s) => {
    const first = s.events[0];
    const last = s.events[s.events.length - 1];

    return {
      sku: s.item.product.sku,
      warehouseCode: s.item.warehouseCode,
      quantity: s.onHand,
      reservedQuantity: s.reserved,
      createdAt: new Date(first.ts).toISOString(),
      updatedAt: new Date(last.ts).toISOString(),
    };
  });

  return {
    meta: {
      seed,
      endDate,
      days: DAYS,
      startDate: new Date(start0).toISOString().slice(0, 10),
      timezoneOffsetHours: TZ_OFFSET_HOURS,
    },
    company,
    factory,
    warehouses,
    categories,
    suppliers,
    products: products.map(({ supplierOptions, ...product }) => product),
    supplierProducts: products.flatMap((product) =>
      product.supplierOptions.map((option) => ({ sku: product.sku, ...option }))
    ),
    purchaseOrders,
    goodsReceipts,
    transfers,
    ledger,
    inventory,
    anomalyLabels: buildLabels({ ledger, seed, endDate }),
  };
};

module.exports = { buildDataset, ANOMALY_PLAN };
