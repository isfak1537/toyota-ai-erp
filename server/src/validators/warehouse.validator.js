const { z } = require("zod");

const createWarehouseSchema = z.object({
  name: z.string().trim().min(1, "Warehouse name is required"),
  code: z.string().trim().min(1, "Warehouse code is required"),
  factoryId: z.number().int().positive("Factory ID must be positive"),
  address: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

const updateWarehouseSchema = z.object({
  name: z.string().trim().min(1, "Warehouse name is required").optional(),
  code: z.string().trim().min(1, "Warehouse code is required").optional(),
  factoryId: z.number().int().positive().optional(),
  address: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  createWarehouseSchema,
  updateWarehouseSchema,
};