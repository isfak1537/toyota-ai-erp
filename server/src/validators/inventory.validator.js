const { z } = require("zod");

const createInventorySchema = z
  .object({
    productId: z
      .number()
      .int()
      .positive("Product ID must be a positive integer"),

    warehouseId: z
      .number()
      .int()
      .positive("Warehouse ID must be a positive integer"),

    quantity: z
      .number()
      .int()
      .min(0, "Quantity cannot be negative")
      .optional(),

    reservedQuantity: z
      .number()
      .int()
      .min(0, "Reserved quantity cannot be negative")
      .optional(),
  })
  .refine(
    (data) =>
      (data.reservedQuantity ?? 0) <=
      (data.quantity ?? 0),
    {
      message:
        "Reserved quantity cannot be greater than quantity",
      path: ["reservedQuantity"],
    }
  );

const updateInventorySchema = z
  .object({
    quantity: z
      .number()
      .int()
      .min(0, "Quantity cannot be negative")
      .optional(),

    reservedQuantity: z
      .number()
      .int()
      .min(0, "Reserved quantity cannot be negative")
      .optional(),
  })
  .refine(
    (data) => {
      if (
        data.quantity !== undefined &&
        data.reservedQuantity !== undefined
      ) {
        return data.reservedQuantity <= data.quantity;
      }

      return true;
    },
    {
      message:
        "Reserved quantity cannot be greater than quantity",
      path: ["reservedQuantity"],
    }
  );

module.exports = {
  createInventorySchema,
  updateInventorySchema,
};