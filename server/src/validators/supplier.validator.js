const { z } = require("zod");

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required"),
  code: z.string().trim().min(1, "Supplier code is required"),
  email: z.string().email("Invalid email").optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  paymentTermsDays: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const updateSupplierSchema = z.object({
  name: z.string().trim().min(1, "Supplier name cannot be empty").optional(),
  code: z.string().trim().min(1, "Supplier code cannot be empty").optional(),
  email: z.string().email("Invalid email").nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  paymentTermsDays: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  createSupplierSchema,
  updateSupplierSchema,
};