const prisma = require("../../config/prisma");
const { getAiClient } = require("./ai.client");
const { NotFoundError } = require("../../errors/app-error");
const { writeAudit } = require("../../services/audit.service");

const TRAIN_LOCK_KEY = 7341003;
const TYPE_OF = { forecast: "FORECAST", anomaly: "ANOMALY" };

const listModelRuns = async ({ modelType, skip, take }) => {
  const where = modelType ? { modelType } : {};

  const [items, total] = await prisma.$transaction([
    prisma.aiModelRun.findMany({ where, orderBy: [{ trainedAt: "desc" }, { id: "desc" }], skip, take }),
    prisma.aiModelRun.count({ where }),
  ]);

  return { items, total };
};

// AI-013. The AI service trains and evaluates a new version while the old one keeps serving, then
// swaps atomically; this records what it reported. Versions are content hashes there, so training on
// unchanged data yields the same version: that run is re-activated instead of duplicated.
const retrain = async ({ models, asOf }, actor) => {
  const response = await getAiClient().train({ ...(models && { models }), ...(asOf && { asOf }) });

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAIN_LOCK_KEY}::int)`; // released at commit

    const runs = [];

    for (const trained of response.trained) {
      const modelType = TYPE_OF[trained.kind];

      if (!trained.activated) {
        continue;
      }

      await tx.aiModelRun.updateMany({ where: { modelType, isActive: true }, data: { isActive: false } });

      const existing = await tx.aiModelRun.findFirst({ where: { modelType, version: trained.version } });
      const data = { metrics: trained.metrics ?? {}, isActive: true };

      runs.push(
        existing
          ? await tx.aiModelRun.update({ where: { id: existing.id }, data })
          : await tx.aiModelRun.create({ data: { modelType, version: trained.version, ...data } })
      );
    }

    await writeAudit(tx, {
      eventType: "MODEL_RETRAIN",
      actorUserId: actor.id,
      payload: { requested: models ?? ["forecast", "anomaly"], asOf: asOf ?? null, versions: runs.map((r) => ({ type: r.modelType, version: r.version })) },
    });

    return runs;
  });
};

// UI-003. History, baseline and ML forecast for one product, in one warehouse or in each warehouse that stocks it.
const productForecast = async ({ productId, warehouseId, horizonDays }) => {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, sku: true, name: true } });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const rows = await prisma.inventory.findMany({
    where: { productId, ...(warehouseId && { warehouseId }) },
    select: { warehouseId: true },
    orderBy: { warehouseId: "asc" },
  });

  if (warehouseId && rows.length === 0) {
    throw new NotFoundError("No inventory record for this product and warehouse");
  }

  if (rows.length === 0) {
    return { product, modelVersion: null, asOf: null, horizonDays, results: [] };
  }

  const response = await getAiClient().forecast({
    series: rows.map((row) => ({ productId, warehouseId: row.warehouseId })),
    horizonDays,
  });

  return { product, ...response };
};

module.exports = { listModelRuns, retrain, productForecast };
