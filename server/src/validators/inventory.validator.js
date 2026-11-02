const { z } = require("zod");
const {
  positiveInt,
  quantity,
  nonNegativeInt,
  nonZeroInt,
  optionalId,
  optionalText,
} = require("./common.validator");

const createInventorySchema = z
  .strictObject({
    productId: positiveInt("productId"),
    warehouseId: positiveInt("warehouseId"),
    quantity: nonNegativeInt("Quantity").optional(),
    reservedQuantity: nonNegativeInt("Reserved quantity").optional(),
  })
  .refine(
    (data) => (data.reservedQuantity ?? 0) <= (data.quantity ?? 0),
    {
      message: "Reserved quantity cannot be greater than quantity",
      path: ["reservedQuantity"],
    }
  );

// Quantities cannot be edited directly; the service answers with its explicit
// "use receive, issue, adjust, reserve or release" message. Unknown fields are
// rejected here instead of reaching Prisma.
const updateInventorySchema = z.strictObject({
  quantity: nonNegativeInt("Quantity").optional(),
  reservedQuantity: nonNegativeInt("Reserved quantity").optional(),
});

const operationFields = {
  productId: positiveInt("productId"),
  warehouseId: positiveInt("warehouseId"),
  referenceType: optionalText("referenceType", 50),
  referenceId: optionalId("referenceId"),
  reason: optionalText("reason", 255),
};

const receiveStockSchema = z.strictObject({
  ...operationFields,
  quantity: quantity("Receipt quantity"),
});

const issueStockSchema = z.strictObject({
  ...operationFields,
  quantity: quantity("Issue quantity"),
});

const adjustStockSchema = z.strictObject({
  ...operationFields,
  quantity: nonZeroInt("Adjustment quantity"),
});

const reserveStockSchema = z.strictObject({
  ...operationFields,
  quantity: quantity("Reservation quantity"),
});

const releaseStockSchema = z.strictObject({
  ...operationFields,
  quantity: quantity("Release quantity"),
});

module.exports = {
  createInventorySchema,
  updateInventorySchema,
  receiveStockSchema,
  issueStockSchema,
  adjustStockSchema,
  reserveStockSchema,
  releaseStockSchema,
};
