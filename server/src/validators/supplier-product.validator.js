const { z } = require("zod");

const createSupplierProductSchema = z.object({
  supplierId: z.number().int().positive("Supplier ID must be positive"),
  productId: z.number().int().positive("Product ID must be positive"),
  supplierSku: z.string().trim().optional(),
  unitPrice: z.number().positive("Unit price must be greater than 0"),
  leadTimeDays: z.number().int().min(0).optional(),
  minimumOrderQty: z.number().int().positive().optional(),
  isPreferred: z.boolean().optional(),
});

const updateSupplierProductSchema = z.object({
  supplierSku: z.string().trim().nullable().optional(),
  unitPrice: z.number().positive().optional(),
  leadTimeDays: z.number().int().min(0).nullable().optional(),
  minimumOrderQty: z.number().int().positive().optional(),
  isPreferred: z.boolean().optional(),
});

module.exports = {
  createSupplierProductSchema,
  updateSupplierProductSchema,
};