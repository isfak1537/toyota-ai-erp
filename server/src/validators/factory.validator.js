const { z } = require("zod");

const createFactorySchema = z.object({
  name: z.string().trim().min(1, "Factory name is required"),
  code: z.string().trim().min(1, "Factory code is required"),
  companyId: z.number().int().positive("Company ID must be positive"),
  address: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

const updateFactorySchema = z.object({
  name: z.string().trim().min(1, "Factory name is required").optional(),
  code: z.string().trim().min(1, "Factory code is required").optional(),
  companyId: z.number().int().positive().optional(),
  address: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  createFactorySchema,
  updateFactorySchema,
};