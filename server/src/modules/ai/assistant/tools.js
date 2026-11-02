const { z } = require("zod");

const { ServiceUnavailableError } = require("../../../errors/app-error");
const { daysOfCover, lowStock: lowStockOf, computeDaysOfCover } = require("../cover");

// The assistant's tools (AI-010). Every tool only READS. There is deliberately no tool that
// creates, updates or deletes anything: not suggestions, not requisitions, not stock. The set is
// fixed here, a model cannot add to it, and an unknown tool name does nothing. A test pins this by
// running every tool against a database proxy that throws on any write and by scanning this file.

const LIMIT = z.number().int().min(1).max(20).optional().default(10);
const tools = ({ db, aiClient }) => {
  const lookupProduct = async (sku) => db.product.findUnique({ where: { sku }, select: { id: true, sku: true, name: true } });

  const warehouseFilter = async (code) => {
    if (!code) return {};

    const warehouse = await db.warehouse.findFirst({ where: { code }, select: { id: true } });

    return warehouse ? { warehouseId: warehouse.id } : null;
  };

  const lowStock = (args) => lowStockOf(db, args);

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
      run: ({ warehouseCode, limit }) => computeDaysOfCover({ db, aiClient, warehouseCode, limit }),
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
