const { z } = require("zod");

const createProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required"),
  name: z.string().trim().min(1, "Product name is required"),
  description: z.string().trim().optional(),
  barcode: z.string().trim().min(1).optional(),
  price: z.number().positive("Price must be greater than 0"),
  unit: z.string().trim().min(1, "Unit is required"),
  categoryId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  isStockTracked: z.boolean().optional(),
  reorderLevel: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  maxStock: z.number().int().min(0).nullable().optional(),
});

const updateProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU cannot be empty").optional(),
  name: z.string().trim().min(1, "Product name cannot be empty").optional(),
  description: z.string().trim().optional(),
  barcode: z.string().trim().min(1).nullable().optional(),
  price: z.number().positive("Price must be greater than 0").optional(),
  unit: z.string().trim().min(1, "Unit cannot be empty").optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  isStockTracked: z.boolean().optional(),
  reorderLevel: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  maxStock: z.number().int().min(0).nullable().optional(),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
};