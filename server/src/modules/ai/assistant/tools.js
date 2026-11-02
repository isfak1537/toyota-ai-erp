const { z } = require("zod");

const { ServiceUnavailableError } = require("../../../errors/app-error");

// The assistant's tools (AI-010). Every tool only READS. There is deliberately no tool that
// creates, updates or deletes anything: not suggestions, not requisitions, not stock. The set is
// fixed here, a model cannot add to it, and an unknown tool name does nothing. A test pins this by
// running every tool against a database proxy that throws on any write and by scanning this file.

const LIMIT = z.number().int().min(1).max(20).optional().default(10);
const FORECAST_SERIES_MAX = 100; // stock rows forecast at once (lowest available first)
const COVER_HORIZON = 30;

// Days until `available` units are used up by the forecast daily demand, with a fraction for the last
// day. Returns null when the stock lasts through the whole forecast horizon (more than the horizon).
const daysOfCover = (available, dailyMeans) => {
  if (available <= 0) return 0;

  let remaining = available;

  for (let day = 0; day < dailyMeans.length; day += 1) {
    const demand = Math.max(0, dailyMeans[day]);

    if (demand >= remaining) return Number((day + remaining / demand).toFixed(1));

    remaining -= demand;
  }

  return null;
};

const tools = ({ db, aiClient }) => {
  const lookupProduct = async (sku) => db.product.findUnique({ where: { sku }, select: { id: true, sku: true, name: true } });

  const warehouseFilter = async (code) => {
    if (!code) return {};

    const warehouse = await db.warehouse.findFirst({ where: { code }, select: { id: true } });

    return warehouse ? { warehouseId: warehouse.id } : null;
  };

  const lowStock = async ({ limit }) => {
    const rows = await db.inventory.findMany({
      include: { product: { select: { sku: true, name: true, reorderLevel: true } }, warehouse: { select: { code: true } } },
      orderBy: [{ quantity: "asc" }, { id: "asc" }],
    });
    const low = rows
      .map((r) => ({ sku: r.product.sku, name: r.product.name, warehouse: r.warehouse.code, onHand: r.quantity, reserved: r.reservedQuantity, available: r.quantity - r.reservedQuantity, reorderLevel: r.product.reorderLevel }))
      .filter((r) => r.available <= r.reorderLevel);

    return { total: low.length, items: low.slice(0, limit) };
  };

  return [
    {
      name: "get_low_stock",
      description: "List stock records whose available quantity (on hand minus reserved) is at or below the product's reorder level.",
      parameters: z.strictObject({ limit: LIMIT }),
      run: lowStock,
    },
    {
      name: "get_stock",
      description: "Show on-hand, reserved and available quantity of one product (by SKU), optionally in one warehouse (by code).",
      parameters: z.strictObject({ sku: z.string().min(1).max(60), warehouseCode: z.string().min(1).max(60).optional() }),
      run: async ({ sku, warehouseCode }) => {
        const product = await lookupProduct(sku);
        const where = await warehouseFilter(warehouseCode);

        if (!product || where === null) return { error: "No such product or warehouse" };

        const rows = await db.inventory.findMany({ where: { productId: product.id, ...where }, include: { warehouse: { select: { code: true } } } });

        return { product, stock: rows.map((r) => ({ warehouse: r.warehouse.code, onHand: r.quantity, reserved: r.reservedQuantity, available: r.quantity - r.reservedQuantity })) };
      },
    },
    {
      name: "get_forecast",
      description: "Demand forecast for one product (by SKU), optionally one warehouse (by code): expected units per day, uncertainty, model used and its holdout error.",
      parameters: z.strictObject({ sku: z.string().min(1).max(60), warehouseCode: z.string().min(1).max(60).optional(), horizonDays: z.number().int().min(1).max(30).optional().default(14) }),
      run: async ({ sku, warehouseCode, horizonDays }) => {
        const product = await lookupProduct(sku);
        const where = await warehouseFilter(warehouseCode);

        if (!product || where === null) return { error: "No such product or warehouse" };

        const rows = await db.inventory.findMany({ where: { productId: product.id, ...where }, include: { warehouse: { select: { code: true } } } });

        if (rows.length === 0) return { error: "No stock record for this product" };

        let response;

        try {
          response = await aiClient().forecast({ series: rows.map((r) => ({ productId: product.id, warehouseId: r.warehouseId })), horizonDays });
        } catch (error) {
          if (error instanceof ServiceUnavailableError) return { error: "The forecasting service is unavailable right now" };
          throw error;
        }

        const codeOf = new Map(rows.map((r) => [r.warehouseId, r.warehouse.code]));

        return {
          product,
          modelVersion: response.modelVersion,
          horizonDays,
          warehouses: response.results.map((r) =>
            r.status === "OK"
              ? {
                  warehouse: codeOf.get(r.warehouseId),
                  selectedModel: r.selectedModel,
                  unitsPerDay: Number(r.dailyMean.toFixed(2)),
                  uncertaintyPerDay: Number(r.sigma.toFixed(2)),
                  totalOverHorizon: Number(r.forecast.reduce((sum, d) => sum + d.mean, 0).toFixed(1)),
                  holdoutMaeBaseline: r.metrics.maeBaseline,
                  holdoutMaeMl: r.metrics.maeMl,
                }
              : { warehouse: codeOf.get(r.warehouseId), status: r.status }
          ),
        };
      },
    },
    {
      name: "get_days_of_cover",
      description: "Which stock will run out first: days of cover per product and warehouse (available stock divided by the forecast daily demand, up to 30 days), soonest first. Use this for 'what runs out soonest'. If the forecasting service is down it says so and returns the low-stock list instead.",
      parameters: z.strictObject({ warehouseCode: z.string().min(1).max(60).optional(), limit: LIMIT }),
      run: async ({ warehouseCode, limit }) => {
        const where = await warehouseFilter(warehouseCode);

        if (where === null) return { error: "No such warehouse" };

        const rows = await db.inventory.findMany({
          where: { ...where, product: { isActive: true, isStockTracked: true } },
          include: { product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } } },
        });
        const stocked = rows
          .map((r) => ({ r, available: r.quantity - r.reservedQuantity }))
          .sort((a, b) => a.available - b.available || a.r.id - b.r.id)
          .slice(0, FORECAST_SERIES_MAX);

        let response;

        try {
          response = await aiClient().forecast({ series: stocked.map(({ r }) => ({ productId: r.productId, warehouseId: r.warehouseId })), horizonDays: COVER_HORIZON });
        } catch (error) {
          if (!(error instanceof ServiceUnavailableError)) throw error;

          return {
            forecastAvailable: false,
            message: "The forecasting service is unavailable, so days of cover cannot be computed. Showing stock at or below reorder levels instead (not a forecast).",
            fallback: await lowStock({ limit }),
          };
        }

        const forecastOf = new Map(response.results.map((x) => [`${x.productId}:${x.warehouseId}`, x]));
        const open = await db.purchaseOrderItem.findMany({
          where: { productId: { in: stocked.map(({ r }) => r.productId) }, purchaseOrder: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } },
          select: { productId: true, quantity: true, receivedQuantity: true, purchaseOrder: { select: { destinationWarehouseId: true } } },
        });
        const incoming = (productId, warehouseId) =>
          open.filter((o) => o.productId === productId && o.purchaseOrder.destinationWarehouseId === warehouseId).reduce((sum, o) => sum + Math.max(0, o.quantity - o.receivedQuantity), 0);

        const items = [];
        let withoutForecast = 0;

        for (const { r, available } of stocked) {
          const f = forecastOf.get(`${r.productId}:${r.warehouseId}`);

          if (!f || f.status !== "OK") {
            withoutForecast += 1;
            continue;
          }

          const means = f.forecast.map((d) => d.mean);
          const cover = daysOfCover(available, means);

          items.push({
            sku: r.product.sku,
            name: r.product.name,
            warehouse: r.warehouse.code,
            available,
            forecastUnitsPerDay: Number(f.dailyMean.toFixed(2)),
            daysOfCover: cover, // null: lasts beyond the 30-day forecast
            lastsBeyondHorizon: cover === null,
            openOrderUnitsToThisWarehouse: incoming(r.productId, r.warehouseId),
            model: f.selectedModel,
          });
        }

        items.sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) || a.sku.localeCompare(b.sku));

        return { forecastAvailable: true, horizonDays: COVER_HORIZON, note: "Days of cover ignore open purchase orders; see openOrderUnitsToThisWarehouse.", withoutForecast, items: items.slice(0, limit) };
      },
    },
    {
      name: "list_suggestions",
      description: "List replenishment suggestions (default PENDING) with product, warehouse, supplier, suggested quantity and the inputs behind it.",
      parameters: z.strictObject({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional().default("PENDING"), limit: LIMIT }),
      run: async ({ status, limit }) => {
        const [total, rows] = await Promise.all([
          db.aiSuggestion.count({ where: { status } }),
          db.aiSuggestion.findMany({
            where: { status },
            take: limit,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: { product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } }, supplier: { select: { name: true } } },
          }),
        ]);

        return {
          status,
          total,
          items: rows.map((r) => ({ id: r.id, sku: r.product.sku, name: r.product.name, warehouse: r.warehouse.code, supplier: r.supplier.name, suggestedQty: r.suggestedQty, available: r.available, onOrder: r.onOrder, reorderPoint: Number(r.reorderPoint.toFixed(1)), leadTimeDays: r.leadTimeDays })),
        };
      },
    },
    {
      name: "list_anomalies",
      description: "List flagged stock transactions. kind 'rule' = confirmed rule hits, 'queue' = the weekly model review queue. Default status OPEN.",
      parameters: z.strictObject({ kind: z.enum(["rule", "queue"]).optional(), status: z.enum(["OPEN", "REVIEWED"]).optional().default("OPEN"), limit: LIMIT }),
      run: async ({ kind, status, limit }) => {
        const where = { status, ...(kind === "rule" && { ruleCodes: { isEmpty: false } }), ...(kind === "queue" && { queueRank: { not: null } }) };
        const [total, rows] = await Promise.all([
          db.anomalyFlag.count({ where }),
          db.anomalyFlag.findMany({
            where,
            take: limit,
            orderBy: [{ score: "desc" }, { id: "desc" }],
            include: { transaction: { select: { type: true, quantity: true, createdAt: true, product: { select: { sku: true } }, warehouse: { select: { code: true } } } } },
          }),
        ]);

        return {
          total,
          items: rows.map((r) => ({ id: r.id, sku: r.transaction.product.sku, warehouse: r.transaction.warehouse.code, type: r.transaction.type, units: r.transaction.quantity, at: r.transaction.createdAt.toISOString(), score: Number(r.score.toFixed(3)), source: r.source, ruleCodes: r.ruleCodes, queueRank: r.queueRank, reason: r.reason })),
        };
      },
    },
    {
      name: "get_models",
      description: "The most recent trained models with their evaluation metrics and which one is active.",
      parameters: z.strictObject({}),
      run: async () => {
        const rows = await db.aiModelRun.findMany({ orderBy: [{ trainedAt: "desc" }, { id: "desc" }], take: 6 });

        return { items: rows.map((r) => ({ type: r.modelType, version: r.version, active: r.isActive, trainedAt: r.trainedAt.toISOString(), metrics: r.metrics })) };
      },
    },
  ];
};

module.exports = { tools, daysOfCover };
