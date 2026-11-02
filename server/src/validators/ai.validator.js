const { z } = require("zod");

const runReplenishmentSchema = z.strictObject({});

// Query-string filters. Unknown values are a 400, never silently ignored.
const listSuggestionsQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
  productId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
});

module.exports = { runReplenishmentSchema, listSuggestionsQuery };
