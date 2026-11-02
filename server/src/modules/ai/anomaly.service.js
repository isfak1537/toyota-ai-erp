const prisma = require("../../config/prisma");
const { getAiClient } = require("./ai.client");
const { NotFoundError } = require("../../errors/app-error");
const { writeAudit } = require("../../services/audit.service");
const { explainMany, explainAnomaly } = require("./llm/explain");

const EXPLAIN_PER_SYNC = 10; // the rest are explained on demand; keeps within the LLM quota and leaves room for people

const SYNC_LOCK_KEY = 7341002;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 7;

const flagInclude = {
  transaction: {
    select: {
      id: true,
      type: true,
      quantity: true,
      balanceAfter: true,
      reason: true,
      createdAt: true,
      createdById: true,
      product: { select: { id: true, sku: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
  },
  reviewedBy: { select: { id: true, name: true } },
};

// The two lists the UI shows apart (P6): "Confirmed rule hits" are rows a rule flagged; the "Weekly
// review queue" are rows the model ranked into the queue. A row that is both appears in both.
const KIND_FILTER = {
  rule: { ruleCodes: { isEmpty: false } },
  queue: { queueRank: { not: null } },
};

// AI-008. Scores a window of transactions through the AI service and stores one AnomalyFlag per
// flagged transaction. Re-running is safe: flags are upserted on the transaction id, and a flag a
// person has reviewed keeps its review (status, reviewer, note); only its score data is refreshed.
const syncAnomalies = async ({ from, to, transactionIds, queueSize, queuePeriod }, actor) => {
  const now = Date.now();
  const window = transactionIds
    ? { transactionIds }
    : { from: from ?? new Date(now - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString(), to: to ?? new Date(now).toISOString() };

  const response = await getAiClient().scoreAnomalies({
    ...window,
    ...(queueSize !== undefined && { queueSize }),
    ...(queuePeriod !== undefined && { queuePeriod }),
  });

  const ids = response.flags.map((flag) => flag.inventoryTransactionId);
  const known = new Set(
    (await prisma.inventoryTransaction.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id)
  );

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY}::int)`; // released at commit

    const existingFlags = new Map(
      (await tx.anomalyFlag.findMany({ where: { inventoryTransactionId: { in: ids } }, select: { inventoryTransactionId: true, source: true, ruleCodes: true, explanation: true } })).map(
        (row) => [row.inventoryTransactionId, row]
      )
    );
    const existing = new Set(existingFlags.keys());

    let created = 0;
    let updated = 0;
    let ignored = 0;
    const toExplain = [];

    for (const flag of response.flags) {
      if (!known.has(flag.inventoryTransactionId)) {
        ignored += 1;
        continue;
      }

      const data = {
        score: flag.score,
        reason: flag.reason ?? "",
        source: flag.source,
        ruleCodes: flag.ruleCodes ?? [],
        queueRank: flag.queueRank ?? null,
        period: flag.period ?? null,
        topFeatures: flag.topFeatures ?? null,
        modelVersion: response.modelVersion,
      };

      const before = existingFlags.get(flag.inventoryTransactionId);
      // an explanation describes what flagged the row; if that changed, it is stale and is regenerated
      const detectorsChanged = before && (before.source !== data.source || before.ruleCodes.join() !== data.ruleCodes.join());

      await tx.anomalyFlag.upsert({
        where: { inventoryTransactionId: flag.inventoryTransactionId },
        create: { inventoryTransactionId: flag.inventoryTransactionId, ...data },
        update: { ...data, ...(detectorsChanged && { explanation: null, explanationSource: null }) }, // status, reviewer and note are never part of an update
      });

      if (!before || detectorsChanged || !before.explanation) toExplain.push({ key: flag.inventoryTransactionId, score: flag.score });

      if (existing.has(flag.inventoryTransactionId)) updated += 1;
      else created += 1;
    }

    const summary = {
      modelVersion: response.modelVersion,
      window,
      scored: response.scored,
      flagged: response.flags.length,
      created,
      updated,
      ignored,
    };

    await writeAudit(tx, { eventType: "ANOMALY_SYNC", actorUserId: actor?.id ?? null, payload: summary });

    return { summary, toExplain };
  });

  // AI-009: explain the highest-scoring new or changed flags, best effort, outside the transaction
  const wanted = result.toExplain.sort((a, b) => b.score - a.score).slice(0, EXPLAIN_PER_SYNC).map((x) => x.key);
  const flagIds = (await prisma.anomalyFlag.findMany({ where: { inventoryTransactionId: { in: wanted } }, select: { id: true } })).map((row) => row.id);
  const explained = await explainMany(flagIds, (id) => explainAnomaly(id, actor?.id ?? null, { background: true }));

  return { ...result.summary, explained };
};

const listAnomalies = async ({ status, kind, skip, take }) => {
  const where = { ...(status && { status }), ...(kind && KIND_FILTER[kind]) };
  const orderBy =
    kind === "queue"
      ? [{ period: "desc" }, { queueRank: "asc" }]
      : [{ inventoryTransactionId: "desc" }];

  const [items, total] = await prisma.$transaction([
    prisma.anomalyFlag.findMany({ where, include: flagInclude, orderBy, skip, take }),
    prisma.anomalyFlag.count({ where }),
  ]);

  return { items, total };
};

// Marks a flag reviewed. A flag that is already reviewed is returned unchanged: the first review stands.
const reviewAnomaly = async (id, note, actor) =>
  prisma.$transaction(async (tx) => {
    const claimed = await tx.anomalyFlag.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "REVIEWED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note ?? null },
    });

    const flag = await tx.anomalyFlag.findUnique({ where: { id }, include: flagInclude });

    if (!flag) {
      throw new NotFoundError("Anomaly flag not found");
    }

    if (claimed.count === 1) {
      await writeAudit(tx, {
        eventType: "ANOMALY_REVIEWED",
        actorUserId: actor.id,
        payload: { anomalyFlagId: id, inventoryTransactionId: flag.inventoryTransactionId, note: note ?? null },
      });
    }

    return { flag, idempotent: claimed.count === 0 };
  });

module.exports = { syncAnomalies, listAnomalies, reviewAnomaly, flagInclude };
