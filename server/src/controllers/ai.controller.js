const replenishment = require("../modules/ai/replenishment.service");
const suggestions = require("../modules/ai/suggestion.service");
const anomalies = require("../modules/ai/anomaly.service");
const { parseId } = require("../utils/ids");
const { parsePagination, toPagination } = require("../utils/pagination");
const { ValidationError } = require("../errors/app-error");
const { fieldDetails } = require("../utils/zod-details");
const { listSuggestionsQuery, listAnomaliesQuery } = require("../validators/ai.validator");

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

module.exports = {
  runReplenishment,
  listSuggestions,
  approveSuggestion,
  rejectSuggestion,
  syncAnomalies,
  listAnomalies,
  reviewAnomaly,
};
