const { z } = require("zod");
const {
  positiveInt,
  quantity,
  optionalText,
  uniqueProducts,
} = require("./common.validator");

const completeTransferSchema = z
  .strictObject({
    fromWarehouseId: positiveInt("fromWarehouseId"),
    toWarehouseId: positiveInt("toWarehouseId"),
    items: z
      .array(
        z.strictObject({
          productId: positiveInt("productId"),
          quantity: quantity("quantity"),
        }),
        { error: "items must be an array" }
      )
      .min(1, "At least one transfer item is required")
      .max(200, "A transfer can have at most 200 items"),
    notes: optionalText("notes"),
  })
  .refine((data) => data.fromWarehouseId !== data.toWarehouseId, {
    message: "Source and destination warehouses must be different",
    path: ["toWarehouseId"],
  })
  .superRefine(
    uniqueProducts((id) => `Product ${id} appears more than once in the transfer`)
  );

module.exports = { completeTransferSchema };
