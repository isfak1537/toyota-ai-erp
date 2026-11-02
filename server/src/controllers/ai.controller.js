const prisma = require("../config/prisma");
const replenishment = require("../modules/ai/replenishment.service");
const suggestions = require("../modules/ai/suggestion.service");
const anomalies = require("../modules/ai/anomaly.service");
const models = require("../modules/ai/models.service");
const explain = require("../modules/ai/llm/explain");
const assistant = require("../modules/ai/assistant/assistant.service");
const { NotFoundError } = require("../errors/app-error");
const { parseId } = require("../utils/ids");
const { parsePagination, toPagination } = require("../utils/pagination");
const { ValidationError } = require("../errors/app-error");
const { fieldDetails } = require("../utils/zod-details");
const { listSuggestionsQuery, listAnomaliesQuery, listModelsQuery, forecastQuery, daysOfCoverQuery, auditQuery } = require("../validators/ai.validator");
const { computeDaysOfCover } = require("../modules/ai/cover");
const { getAiClient } = require("../modules/ai/ai.client");
const { listAuditLog } = require("../modules/ai/audit-log.service");

const parseQuery = (schema, query) => {
  const result = schema.safeParse(query);

  if (!result.success) {
    throw new ValidationError("Invalid query parameters", fieldDetails(result.error.issues));
  }

  return result.data;
};

const runReplenishment = async (req, res) => {
  const data = await replenishment.runReplenishment(req.user);

  res.status(201).json({
    success: true,
    message: `Replenishment run created ${data.suggestions.length} suggestion(s)`,
    data,
  });
};

const listSuggestions = async (req, res) => {
  const filters = parseQuery(listSuggestionsQuery, req.query);
  const pagination = parsePagination(req.query);
  const { items, total } = await replenishment.listSuggestions({ ...filters, skip: pagination.skip, take: pagination.take });

  res.json({
    success: true,
    data: items,
    pagination: toPagination(pagination, total),
  });
};

const approveSuggestion = async (req, res) => {
  const data = await suggestions.approveSuggestion(parseId(req.params.id, "Invalid suggestion ID"), req.user);

  res.status(data.idempotent ? 200 : 201).json({
    success: true,
    message: data.idempotent ? "Suggestion was already approved" : "Suggestion approved; draft requisition created",
    data,
  });
};

const rejectSuggestion = async (req, res) => {
  const data = await suggestions.rejectSuggestion(parseId(req.params.id, "Invalid suggestion ID"), req.body.reason, req.user);

  res.json({
    success: true,
    message: data.idempotent ? "Suggestion was already rejected" : "Suggestion rejected",
    data,
  });
};

const syncAnomalies = async (req, res) => {
  const data = await anomalies.syncAnomalies(req.body, req.user);

  res.json({ success: true, message: `Synced ${data.flagged} flagged transaction(s)`, data });
};

const listAnomalies = async (req, res) => {
  const filters = parseQuery(listAnomaliesQuery, req.query);
  const pagination = parsePagination(req.query);
  const { items, total } = await anomalies.listAnomalies({ ...filters, skip: pagination.skip, take: pagination.take });

  res.json({ success: true, data: items, pagination: toPagination(pagination, total) });
};

const reviewAnomaly = async (req, res) => {
  const data = await anomalies.reviewAnomaly(parseId(req.params.id, "Invalid anomaly ID"), req.body.note, req.user);

  res.json({ success: true, message: data.idempotent ? "Anomaly was already reviewed" : "Anomaly reviewed", data });
};

const listModels = async (req, res) => {
  const filters = parseQuery(listModelsQuery, req.query);
  const pagination = parsePagination(req.query);
  const { items, total } = await models.listModelRuns({ ...filters, skip: pagination.skip, take: pagination.take });

  res.json({ success: true, data: items, pagination: toPagination(pagination, total) });
};

const retrainModels = async (req, res) => {
  const data = await models.retrain(req.body, req.user);

  res.status(201).json({ success: true, message: `Trained ${data.length} model(s)`, data });
};

const productForecast = async (req, res) => {
  const query = parseQuery(forecastQuery, req.query);
  const data = await models.productForecast({
    productId: parseId(req.params.productId, "Invalid product ID"),
    warehouseId: query.warehouseId,
    horizonDays: query.horizonDays,
  });

  res.json({ success: true, data });
};

const sendExplanation = (res, result) => {
  if (result === null) {
    // not found is handled by the caller; here the LLM simply did not answer
    return res.json({ success: true, message: "Explanation unavailable", data: { explanation: null, explanationSource: null } });
  }

  return res.json({ success: true, message: result.cached ? "Explanation (cached)" : "Explanation generated", data: result });
};

const explainSuggestion = async (req, res) => {
  const id = parseId(req.params.id, "Invalid suggestion ID");

  if (!(await prisma.aiSuggestion.findUnique({ where: { id }, select: { id: true } }))) {
    throw new NotFoundError("AI suggestion not found");
  }

  sendExplanation(res, await explain.explainSuggestion(id, req.user.id));
};

const explainAnomaly = async (req, res) => {
  const id = parseId(req.params.id, "Invalid anomaly ID");

  if (!(await prisma.anomalyFlag.findUnique({ where: { id }, select: { id: true } }))) {
    throw new NotFoundError("Anomaly flag not found");
  }

  sendExplanation(res, await explain.explainAnomaly(id, req.user.id));
};

const ask = async (req, res) => {
  const data = await assistant.ask(req.body.question, req.user);

  res.json({ success: true, message: data.unavailable ? "The assistant is unavailable right now" : "OK", data });
};

const latestReplenishment = async (req, res) => {
  const data = await replenishment.latestRun();

  res.json({ success: true, message: data ? "OK" : "No replenishment run yet", data });
};

const daysOfCover = async (req, res) => {
  const query = parseQuery(daysOfCoverQuery, req.query);
  const data = await computeDaysOfCover({ db: prisma, aiClient: getAiClient, warehouseCode: query.warehouseCode, limit: query.limit });

  if (data.error) {
    throw new NotFoundError(data.error);
  }

  res.json({ success: true, data });
};

const auditLog = async (req, res) => {
  const filters = parseQuery(auditQuery, req.query);
  const pagination = parsePagination(req.query);
  const { items, total, eventTypes } = await listAuditLog({ ...filters, skip: pagination.skip, take: pagination.take });

  res.json({ success: true, data: items, eventTypes, pagination: toPagination(pagination, total) });
};

module.exports = {
  latestReplenishment,
  daysOfCover,
  auditLog,
  ask,
  explainSuggestion,
  explainAnomaly,
  listModels,
  retrainModels,
  productForecast,
  runReplenishment,
  listSuggestions,
  approveSuggestion,
  rejectSuggestion,
  syncAnomalies,
  listAnomalies,
  reviewAnomaly,
};
