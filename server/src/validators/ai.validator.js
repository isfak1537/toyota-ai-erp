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

module.exports = { runReplenishmentSchema, approveSuggestionSchema, rejectSuggestionSchema, listSuggestionsQuery };
