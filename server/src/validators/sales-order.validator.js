const { z } = require("zod");

const salesOrderItemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0).optional(),
});

const createSalesOrderSchema = z.object({
  customerId: z.coerce.number().int().positive(),

  orderDate: z.coerce.date().optional(),
  expectedDate: z.coerce.date().optional(),

  taxAmount: z.coerce.number().min(0).optional(),

  notes: z.string().trim().max(500).optional(),

  items: z
    .array(salesOrderItemSchema)
    .min(1, "At least one sales order item is required"),
});

module.exports = {
  createSalesOrderSchema,
};