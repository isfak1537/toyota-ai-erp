const { z } = require("zod");

const runReplenishmentSchema = z.strictObject({});

const approveSuggestionSchema = z.strictObject({});

const rejectSuggestionSchema = z.strictObject({
  reason: z.string().trim().min(1, "reason is required").max(500, "reason must be at most 500 characters"),
});

// Query-string filters. Unknown values are a 400, never silently ignored.
const listSuggestionsQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
  productId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
});

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000; // the AI service's limit

const isoInstant = (label) =>
  z.iso.datetime({ offset: true, error: `${label} must be an ISO date-time such as 2026-11-01T00:00:00Z` });

// Score either explicit transactions or a time window (default: the last 7 days), not both.
const syncAnomaliesSchema = z
  .strictObject({
    from: isoInstant("from").optional(),
    to: isoInstant("to").optional(),
    transactionIds: z.array(z.number().int().positive()).min(1).max(5000).optional(),
    queueSize: z.number().int().min(0).max(100).optional(),
    queuePeriod: z.enum(["week", "day"]).optional(),
  })
  .superRefine((value, ctx) => {
    const issue = (message, path) => ctx.addIssue({ code: "custom", message, path });

    if (value.transactionIds && (value.from || value.to)) {
      issue("Give transactionIds or a from/to window, not both", ["transactionIds"]);
    }

    if (value.from && value.to) {
      const span = Date.parse(value.to) - Date.parse(value.from);

      if (span <= 0) issue("to must be after from", ["to"]);
      else if (span > MAX_RANGE_MS) issue("The window may be at most 31 days", ["to"]);
    }
  });

const reviewAnomalySchema = z.strictObject({
  note: z.string().trim().max(500, "note must be at most 500 characters").optional(),
});

const listAnomaliesQuery = z.object({
  status: z.enum(["OPEN", "REVIEWED"]).optional(),
  kind: z.enum(["rule", "queue"]).optional(),
});

const retrainSchema = z.strictObject({
  models: z.array(z.enum(["forecast", "anomaly"])).min(1).max(2).optional(),
  asOf: z.iso.date({ error: "asOf must be a date such as 2026-11-01" }).optional(),
});

const listModelsQuery = z.object({
  modelType: z.enum(["FORECAST", "ANOMALY"]).optional(),
});

const forecastQuery = z.object({
  warehouseId: z.coerce.number().int().positive().optional(),
  horizonDays: z.coerce.number().int().min(1).max(30).optional().default(30),
});

module.exports = {
  retrainSchema,
  listModelsQuery,
  forecastQuery,
  syncAnomaliesSchema,
  reviewAnomalySchema,
  listAnomaliesQuery, runReplenishmentSchema, approveSuggestionSchema, rejectSuggestionSchema, listSuggestionsQuery };
