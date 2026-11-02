const crypto = require("crypto");

const env = require("../../config/env");
const prisma = require("../../config/prisma");
const { getAiClient } = require("./ai.client");
const { computeReplenishment, selectSupplier, onOrderFor } = require("./replenishment");
const { writeAudit } = require("../../services/audit.service");
const { explainMany, explainSuggestion } = require("./llm/explain");

const FORECAST_BATCH = 500; // the AI service accepts at most 500 series per request
const FORECAST_HORIZON = 30; // days asked for; the first (lead time + review) days are averaged
const RUN_LOCK_KEY = 7341001; // pg advisory lock: one replenishment run at a time
const OPEN_PO_STATUSES = ["APPROVED", "PARTIALLY_RECEIVED"];

const key = (productId, warehouseId) => `${productId}:${warehouseId}`;

const chunks = (list, size) => {
  const out = [];

  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }

  return out;
};

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

const suggestionInclude = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true } },
};

// AI-004..AI-006, AI-011. Reads stock, suppliers and open purchase orders from the ERP database,
// asks the AI service for demand forecasts, computes the numbers here, and stores PENDING
// suggestions. It never creates a requisition: only an approval does that.
const runReplenishment = async (actor) => {
  const z = env.replenishmentZ;
  const reviewDays = env.replenishmentReviewDays;

  const candidates = await prisma.inventory.findMany({
    where: { product: { isActive: true, isStockTracked: true }, warehouse: { isActive: true } },
    select: { productId: true, warehouseId: true, quantity: true, reservedQuantity: true },
    orderBy: [{ productId: "asc" }, { warehouseId: "asc" }],
  });

  const productIds = [...new Set(candidates.map((c) => c.productId))];

  const [supplierOptions, openItems] = await Promise.all([
    prisma.supplierProduct.findMany({ where: { productId: { in: productIds } }, include: { supplier: true } }),
    prisma.purchaseOrderItem.findMany({
      where: { productId: { in: productIds }, purchaseOrder: { status: { in: OPEN_PO_STATUSES } } },
      select: {
        productId: true,
        quantity: true,
        receivedQuantity: true,
        purchaseOrder: { select: { destinationWarehouseId: true } },
      },
    }),
  ]);

  // forecasts first: if the AI service is down this throws (503) before anything is changed
  const forecasts = new Map();
  let modelVersion = null;
  let asOf = null;

  for (const batch of chunks(candidates, FORECAST_BATCH)) {
    const response = await getAiClient().forecast({
      series: batch.map((c) => ({ productId: c.productId, warehouseId: c.warehouseId })),
      horizonDays: FORECAST_HORIZON,
    });

    modelVersion = response.modelVersion;
    asOf = response.asOf;
    response.results.forEach((result) => forecasts.set(key(result.productId, result.warehouseId), result));
  }

  const supplierByProduct = new Map();

  for (const id of productIds) {
    supplierByProduct.set(id, selectSupplier(supplierOptions.filter((o) => o.productId === id)));
  }

  const openByProduct = new Map();

  for (const item of openItems) {
    const remaining = item.quantity - item.receivedQuantity;

    if (remaining <= 0) continue;

    const entry = openByProduct.get(item.productId) ?? { unaddressed: 0, byWarehouse: new Map() };
    const destination = item.purchaseOrder.destinationWarehouseId;

    if (destination === null) {
      entry.unaddressed += remaining;
    } else {
      entry.byWarehouse.set(destination, (entry.byWarehouse.get(destination) ?? 0) + remaining);
    }

    openByProduct.set(item.productId, entry);
  }

  const dailyFor = (candidate, leadTimeDays) => {
    const result = forecasts.get(key(candidate.productId, candidate.warehouseId));

    if (!result || result.status !== "OK") return null;

    const days = Math.min(FORECAST_HORIZON, Math.max(1, leadTimeDays + reviewDays));

    return mean(result.forecast.slice(0, days).map((day) => day.mean));
  };

  // each product's total forecast demand across its warehouses (denominator of the demand share)
  const productDaily = new Map();

  for (const c of candidates) {
    const result = forecasts.get(key(c.productId, c.warehouseId));
    const daily = result?.status === "OK" ? result.dailyMean : 0;

    productDaily.set(c.productId, (productDaily.get(c.productId) ?? 0) + daily);
  }

  const drafts = [];
  const skipped = [];
  const counts = { evaluated: candidates.length, suggested: 0, notNeeded: 0, coveredByOnOrder: 0, skipped: 0 };
  const runId = crypto.randomUUID();

  for (const c of candidates) {
    const where = { productId: c.productId, warehouseId: c.warehouseId };
    const forecast = forecasts.get(key(c.productId, c.warehouseId));
    const chosen = supplierByProduct.get(c.productId);

    const skip = (reason) => {
      skipped.push({ ...where, reason });
      counts.skipped += 1;
    };

    if (!forecast || forecast.status !== "OK") {
      skip("NO_HISTORY");
      continue;
    }

    if (!chosen) {
      skip("NO_SUPPLIER");
      continue;
    }

    const { option } = chosen;

    if (option.leadTimeDays === null || option.leadTimeDays === undefined) {
      skip("NO_LEAD_TIME");
      continue;
    }

    const open = openByProduct.get(c.productId) ?? { unaddressed: 0, byWarehouse: new Map() };
    const dailyMean = dailyFor(c, option.leadTimeDays);
    const available = c.quantity - c.reservedQuantity;

    const onOrder = onOrderFor({
      destinationQty: open.byWarehouse.get(c.warehouseId) ?? 0,
      unaddressedQty: open.unaddressed,
      warehouseDaily: forecast.dailyMean,
      productDaily: productDaily.get(c.productId),
    });

    const math = computeReplenishment({
      dailyMean,
      sigma: forecast.sigma,
      leadTimeDays: option.leadTimeDays,
      minimumOrderQty: option.minimumOrderQty,
      available,
      onOrder: onOrder.onOrder,
      z,
      reviewDays,
    });

    if (math.suggestedQty === null) {
      counts[math.outcome === "COVERED_BY_ON_ORDER" ? "coveredByOnOrder" : "notNeeded"] += 1;
      continue;
    }

    counts.suggested += 1;
    drafts.push({
      runId,
      ...where,
      supplierId: option.supplierId,
      suggestedQty: math.suggestedQty,
      forecastDaily: dailyMean,
      sigma: forecast.sigma,
      leadTimeDays: option.leadTimeDays,
      minimumOrderQty: option.minimumOrderQty,
      safetyStock: math.safetyStock,
      reorderPoint: math.reorderPoint,
      available,
      onOrder: onOrder.onOrder,
      onOrderMethod: onOrder.method,
      zValue: z,
      reviewDays,
      forecastModel: forecast.selectedModel,
      modelVersion: forecast.modelVersion ?? modelVersion,
      inputs: {
        asOf,
        quantity: c.quantity,
        reserved: c.reservedQuantity,
        horizonDaysAveraged: Math.min(FORECAST_HORIZON, Math.max(1, option.leadTimeDays + reviewDays)),
        warehouseDailyMean: forecast.dailyMean,
        productDailyMean: productDaily.get(c.productId),
        required: math.required,
        rawQty: math.rawQty,
        outcome: math.outcome,
        onOrder: {
          exact: onOrder.exact,
          stored: onOrder.onOrder,
          destinationQty: onOrder.destinationQty,
          unaddressedQty: onOrder.unaddressedQty,
          share: onOrder.share,
          method: onOrder.method,
          rounding: "floor",
        },
        supplier: {
          selection: chosen.reason,
          unitPrice: option.unitPrice.toString(),
          isPreferred: option.isPreferred,
        },
        historyDays: forecast.inputs?.historyDays,
        forecastNotes: forecast.notes,
      },
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RUN_LOCK_KEY}::int)`; // released at commit

    // AI-006: a new run expires every older pending suggestion, then inserts the new ones
    const expired = await tx.aiSuggestion.updateMany({
      where: { status: "PENDING" },
      data: { status: "EXPIRED" },
    });

    const rows = [];

    for (const draft of drafts) {
      rows.push(await tx.aiSuggestion.create({ data: draft, include: suggestionInclude }));
    }

    await writeAudit(tx, {
      eventType: "REPLENISHMENT_RUN",
      actorUserId: actor?.id ?? null,
      payload: {
        runId,
        modelVersion,
        asOf,
        params: { z, reviewDays },
        counts: { ...counts, expiredPending: expired.count },
        skipped,
        suggestionIds: rows.map((row) => row.id),
      },
    });

    return { rows, expired: expired.count };
  });

  // AI-009: explanations are best effort and outside the transaction; a failure leaves explanation null
  const explained = await explainMany(created.rows.map((row) => row.id), (id) => explainSuggestion(id, actor?.id ?? null, { background: true }));
  const suggestions = explained > 0
    ? await prisma.aiSuggestion.findMany({ where: { runId }, include: suggestionInclude, orderBy: { id: "asc" } })
    : created.rows;

  return {
    runId,
    modelVersion,
    asOf,
    params: { z, reviewDays },
    counts: { ...counts, expiredPending: created.expired, explained },
    skipped,
    suggestions,
  };
};

const listSuggestions = async ({ status, productId, warehouseId, skip, take }) => {
  const where = {
    ...(status && { status }),
    ...(productId && { productId }),
    ...(warehouseId && { warehouseId }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.aiSuggestion.findMany({
      where,
      include: suggestionInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.aiSuggestion.count({ where }),
  ]);

  return { items, total };
};

module.exports = { runReplenishment, listSuggestions, suggestionInclude };
