const env = require("../../config/env");
const defaultPrisma = require("../../config/prisma");
const inventoryService = require("../../services/inventory.service");
const { getAiClient } = require("../ai/ai.client");
const { computeReplenishment, selectSupplier, onOrderFor } = require("../ai/replenishment");

// Demo staging (I-8). Drains stock of a few chosen products, through the inventory service like any
// other issue, until each sits just below its AI reorder point, so a replenishment run produces
// suggestions to show. Every row is marked referenceType DEMO_PREPARE (and DEMO_PREPARE_UNDO when put
// back); the AI service ignores those rows, so staging never looks like demand or an anomaly.
//
// It is deliberately model-coupled: it asks the AI service what the reorder point is. It is demo
// data and is labelled as such. The seed and the AI evaluation fixtures are not touched, and
// `npm run seed:synthetic -- --apply --replace` clears these rows with the rest of the seed.

const PREPARE = "DEMO_PREPARE";
const UNDO = "DEMO_PREPARE_UNDO";
const DEFAULT_SKUS = ["SYN-BRK-001", "SYN-ENG-001", "SYN-ENG-004", "SYN-ELE-001", "SYN-ENG-002"]; // the four NEAR_ROP products, plus an air filter
const DEFAULT_WAREHOUSE = "SYN-MAIN";
const TARGET_FRACTION = 0.9; // end 10% below the reorder point
const OPEN_PO_STATUSES = ["APPROVED", "PARTIALLY_RECEIVED"];
const FORECAST_HORIZON = 30;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
};

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

// What would the replenishment run decide for this series, and how much must go for it to order?
const planProduct = async ({ db, aiClient, sku, warehouseCode }) => {
  const product = await db.product.findUnique({ where: { sku }, include: { suppliers: { include: { supplier: true } } } });

  if (!product) return { sku, skip: "no such product" };

  const rows = await db.inventory.findMany({ where: { productId: product.id }, include: { warehouse: true } });
  const row = rows.find((r) => r.warehouse.code === warehouseCode);

  if (!row) return { sku, skip: `no stock record in ${warehouseCode}` };

  const chosen = selectSupplier(product.suppliers);

  if (!chosen || chosen.option.leadTimeDays === null) return { sku, skip: "no active supplier with a lead time" };

  const response = await aiClient().forecast({ series: rows.map((r) => ({ productId: product.id, warehouseId: r.warehouseId })), horizonDays: FORECAST_HORIZON });
  const forecasts = new Map(response.results.map((r) => [r.warehouseId, r]));
  const forecast = forecasts.get(row.warehouseId);

  if (!forecast || forecast.status !== "OK") return { sku, skip: "the AI service has no forecast for it" };

  const productDaily = response.results.reduce((sum, r) => sum + (r.status === "OK" ? r.dailyMean : 0), 0);
  const open = await db.purchaseOrderItem.findMany({
    where: { productId: product.id, purchaseOrder: { status: { in: OPEN_PO_STATUSES } } },
    select: { quantity: true, receivedQuantity: true, purchaseOrder: { select: { destinationWarehouseId: true } } },
  });
  const outstanding = (o) => Math.max(0, o.quantity - o.receivedQuantity);
  const onOrder = onOrderFor({
    destinationQty: open.filter((o) => o.purchaseOrder.destinationWarehouseId === row.warehouseId).reduce((n, o) => n + outstanding(o), 0),
    unaddressedQty: open.filter((o) => o.purchaseOrder.destinationWarehouseId === null).reduce((n, o) => n + outstanding(o), 0),
    warehouseDaily: forecast.dailyMean,
    productDaily,
  });

  const { leadTimeDays, minimumOrderQty } = chosen.option;
  const reviewDays = env.replenishmentReviewDays;
  const days = Math.min(FORECAST_HORIZON, Math.max(1, leadTimeDays + reviewDays));
  const dailyMean = mean(forecast.forecast.slice(0, days).map((d) => d.mean));
  const math = (available) => computeReplenishment({ dailyMean, sigma: forecast.sigma, leadTimeDays, minimumOrderQty, available, onOrder: onOrder.onOrder, z: env.replenishmentZ, reviewDays });

  const available = row.quantity - row.reservedQuantity;
  const now = math(available);
  const target = Math.max(0, Math.floor(now.reorderPoint * TARGET_FRACTION));
  const after = math(target);
  const base = { sku, name: product.name, productId: product.id, warehouseId: row.warehouseId, available, reorderPoint: Number(now.reorderPoint.toFixed(1)), target, onOrder: onOrder.onOrder }

  if (after.suggestedQty === null) return { ...base, skip: onOrder.onOrder > 0 ? `open orders (${onOrder.onOrder} units) would cover the need` : "no order would be needed even at the target" };
  if (available <= target) return { ...base, skip: "already below its reorder point" };

  return { ...base, drain: available - target, suggestedQty: after.suggestedQty };
};

const alreadyPrepared = async (db, productId, warehouseId) => {
  const drains = await db.inventoryTransaction.findMany({ where: { productId, warehouseId, referenceType: PREPARE } });

  if (drains.length === 0) return false;

  const undone = await db.inventoryTransaction.count({ where: { referenceType: UNDO, referenceId: { in: drains.map((d) => d.id) } } });

  return undone < drains.length;
};

const adminUser = async (db) => {
  const user = await db.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { id: "asc" } });

  if (!user) throw new Error("No active ADMIN user found. Run npm run seed:users first.");

  return user;
};

const prepare = async ({ apply = false, skus = DEFAULT_SKUS, warehouseCode = DEFAULT_WAREHOUSE, allowRemote = false, databaseUrl } = {}, deps = {}) => {
  const db = deps.prisma ?? defaultPrisma;
  const aiClient = deps.aiClient ?? getAiClient;
  const issue = deps.issueStock ?? inventoryService.issueStock;
  const host = hostOf(databaseUrl ?? process.env.DATABASE_URL ?? "");

  if (apply && (host === null || !LOCAL_HOSTS.has(host)) && !allowRemote) {
    throw new Error("Refusing to write: the database host is not local. Pass --allow-remote if that is really intended.");
  }

  const actor = apply ? await adminUser(db) : null;
  const plans = [];

  for (const sku of skus) {
    const plan = await planProduct({ db, aiClient, sku, warehouseCode });

    // checked first: a product that is already staged is naturally below its reorder point, and "already prepared" is the useful reason
    if (plan.productId && (await alreadyPrepared(db, plan.productId, plan.warehouseId))) plan.skip = "already prepared (run demo:undo first)";

    plans.push(plan);
  }

  const done = [];

  if (apply) {
    for (const plan of plans.filter((p) => !p.skip)) {
      const result = await issue({
        productId: plan.productId,
        warehouseId: plan.warehouseId,
        quantity: plan.drain,
        referenceType: PREPARE,
        reason: `Demo preparation: stock reduced to ${plan.target}, 10% below the AI reorder point ${plan.reorderPoint}`,
        actorId: actor.id,
      });

      done.push({ ...plan, transactionId: result.transaction.id, availableAfter: plan.target });
    }
  }

  return { applied: apply, plans, done };
};

const undo = async ({ apply = false, allowRemote = false, databaseUrl } = {}, deps = {}) => {
  const db = deps.prisma ?? defaultPrisma;
  const receive = deps.receiveStock ?? inventoryService.receiveStock;
  const host = hostOf(databaseUrl ?? process.env.DATABASE_URL ?? "");

  if (apply && (host === null || !LOCAL_HOSTS.has(host)) && !allowRemote) {
    throw new Error("Refusing to write: the database host is not local. Pass --allow-remote if that is really intended.");
  }

  const drains = await db.inventoryTransaction.findMany({
    where: { referenceType: PREPARE, type: "ISSUE" },
    include: { product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } } },
    orderBy: { id: "asc" },
  });
  const undoneIds = new Set(
    (await db.inventoryTransaction.findMany({ where: { referenceType: UNDO, referenceId: { in: drains.map((d) => d.id) } }, select: { referenceId: true } })).map((r) => r.referenceId)
  );
  const pending = drains.filter((d) => !undoneIds.has(d.id));
  const plans = pending.map((d) => ({ transactionId: d.id, sku: d.product.sku, name: d.product.name, warehouse: d.warehouse.code, productId: d.productId, warehouseId: d.warehouseId, restore: -d.quantity }));
  const done = [];

  if (apply && plans.length > 0) {
    const actor = await adminUser(db);

    for (const plan of plans) {
      const result = await receive({
        productId: plan.productId,
        warehouseId: plan.warehouseId,
        quantity: plan.restore,
        referenceType: UNDO,
        referenceId: plan.transactionId,
        reason: `Demo preparation undone: ${plan.restore} units put back`,
        actorId: actor.id,
      });

      done.push({ ...plan, undoTransactionId: result.transaction.id });
    }
  }

  return { applied: apply, plans, done };
};

module.exports = { prepare, undo, planProduct, hostOf, LOCAL_HOSTS, PREPARE, UNDO, DEFAULT_SKUS, DEFAULT_WAREHOUSE };
