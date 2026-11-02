const replenishment = require("../modules/ai/replenishment.service");
const { parsePagination, toPagination } = require("../utils/pagination");
const { ValidationError } = require("../errors/app-error");
const { fieldDetails } = require("../utils/zod-details");
const { listSuggestionsQuery } = require("../validators/ai.validator");

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

module.exports = { runReplenishment, listSuggestions };
