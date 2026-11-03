const prisma = require("../../../config/prisma");
const { getLlm } = require("./llm.service");

// AI-009. The LLM writes words, never numbers: it is given the computed facts and told to quote them
// as they are. If it fails (or is switched off, or over its quota) the result is null and the caller
// shows "explanation unavailable". Nothing here can make a suggestion or a flag fail (NFR-014).

const SYSTEM = [
  "You write one short explanation (2 to 3 sentences, plain text, no lists, no markdown) for a warehouse or purchasing officer.",
  "Use ONLY the facts in the user message. Quote numbers exactly as given; never calculate, round, estimate or add numbers.",
  "If something is not in the facts, do not mention it. Do not give instructions or advice beyond what the facts state.",
].join(" ");

const num = (value, digits = 1) => (Number.isInteger(value) ? value : Number(value.toFixed(digits)));

const suggestionFacts = (s) => ({
  product: `${s.product.sku} ${s.product.name}`,
  warehouse: s.warehouse.code,
  supplier: s.supplier.name,
  availableUnits: s.available,
  onOrderUnits: s.onOrder,
  onOrderMethod: s.onOrderMethod,
  forecastUnitsPerDay: num(s.forecastDaily),
  uncertaintyPerDay: num(s.sigma),
  leadTimeDays: s.leadTimeDays,
  reviewDays: s.reviewDays,
  safetyStockUnits: num(s.safetyStock),
  reorderPointUnits: num(s.reorderPoint),
  minimumOrderQty: s.minimumOrderQty,
  suggestedOrderQty: s.suggestedQty,
  forecastModel: s.forecastModel === "ML" ? "machine-learning model" : "moving average",
  minimumOrderQtyApplied: s.inputs?.outcome === "SUGGEST_MOQ",
});

const anomalyFacts = (flag) => ({
  product: `${flag.transaction.product.sku} ${flag.transaction.product.name}`,
  warehouse: flag.transaction.warehouse.code,
  movementType: flag.transaction.type,
  units: flag.transaction.quantity,
  balanceAfter: flag.transaction.balanceAfter,
  occurredAtUtc: flag.transaction.createdAt.toISOString(),
  riskScore: num(flag.score, 3),
  flaggedBy: flag.source === "BOTH" ? "rules and the model" : flag.source === "RULE" ? "a rule" : "the statistical model",
  ruleCodes: flag.ruleCodes,
  detectorReason: flag.reason,
  reviewQueueRank: flag.queueRank,
  mostUnusualAspects: (flag.topFeatures ?? []).map((f) => ({ aspect: f.feature, description: f.text ?? null, value: f.value, typical: f.typical })),
});

const ask = async (kind, facts, actorUserId, background) => {
  const result = await getLlm().complete(
    {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Explain this ${kind}.\nFacts (JSON):\n${JSON.stringify(facts)}` },
      ],
      maxTokens: 700,
      temperature: 0.2,
    },
    { purpose: `explain_${kind}`, actorUserId, background }
  );

  return result && result.content ? { text: result.content, source: result.source } : null;
};

const suggestionRelations = {
  product: { select: { sku: true, name: true } },
  warehouse: { select: { code: true } },
  supplier: { select: { name: true } },
};

// Generates and stores the explanation of one suggestion unless it has one. Returns the stored
// explanation or null. The numbers of a suggestion never change, so one explanation per row is the cache.
const explainSuggestion = async (id, actorUserId = null, { background = false } = {}) => {
  const suggestion = await prisma.aiSuggestion.findUnique({ where: { id }, include: suggestionRelations });

  if (!suggestion) return null;
  if (suggestion.explanation) return { explanation: suggestion.explanation, explanationSource: suggestion.explanationSource, cached: true };

  const made = await ask("suggestion", suggestionFacts(suggestion), actorUserId, background);

  if (!made) return null;

  // only the first writer wins (two requests may race)
  await prisma.aiSuggestion.updateMany({ where: { id, explanation: null }, data: { explanation: made.text, explanationSource: made.source } });
  const stored = await prisma.aiSuggestion.findUnique({ where: { id }, select: { explanation: true, explanationSource: true } });

  return { ...stored, cached: false };
};

const explainAnomaly = async (id, actorUserId = null, { background = false } = {}) => {
  const flag = await prisma.anomalyFlag.findUnique({
    where: { id },
    include: { transaction: { include: { product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } } } } },
  });

  if (!flag) return null;
  if (flag.explanation) return { explanation: flag.explanation, explanationSource: flag.explanationSource, cached: true };

  const made = await ask("anomaly flag", anomalyFacts(flag), actorUserId, background);

  if (!made) return null;

  await prisma.anomalyFlag.updateMany({ where: { id, explanation: null }, data: { explanation: made.text, explanationSource: made.source } });
  const stored = await prisma.anomalyFlag.findUnique({ where: { id }, select: { explanation: true, explanationSource: true } });

  return { ...stored, cached: false };
};

// Best effort for a batch (a replenishment run, an anomaly sync): one at a time, stops when the time
// budget is spent, leaves the rest for on-demand requests. Never throws. Batches run as background work,
// which the rate limiter keeps to half of the per-minute budget.
const explainMany = async (ids, explainOne, { concurrency = 1, budgetMs = 20000, now = Date.now } = {}) => {
  const deadline = now() + budgetMs;
  const queue = [...ids];
  let done = 0;

  const worker = async () => {
    while (queue.length > 0 && now() < deadline) {
      const id = queue.shift();

      try {
        if (await explainOne(id)) done += 1;
      } catch {
        // an explanation is never worth failing the caller
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  return done;
};

module.exports = { explainSuggestion, explainAnomaly, explainMany, suggestionFacts, anomalyFacts, SYSTEM };
