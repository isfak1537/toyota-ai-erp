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
const { simulateSeries, at } = require("./simulate");

const { Decimal } = Prisma;
const MAIN = warehouses[0].code;
const DEPOT = warehouses[1].code;
const TAX_RATE = "0.05";

const pad = (n, width = 4) => String(n).padStart(width, "0");

const money = (decimal) => decimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

const seriesRng = (seed, sku, warehouseCode) => new Rng(seed, "series", sku, warehouseCode);

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

const simulateAll = ({ seed, start0, products }) => {
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

const buildDataset = ({ seed = SEED_DEFAULT, endDate = END_DATE_DEFAULT } = {}) => {
  const endMs = parseEndDate(endDate);
  const start0 = endMs - (DAYS - 1) * DAY_MS;
  const products = buildProducts();
  const results = simulateAll({ seed, start0, products });
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
  };
};

module.exports = { buildDataset };
