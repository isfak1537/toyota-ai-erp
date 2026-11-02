const { z } = require("zod");

const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required"),
  code: z.string().trim().min(1, "Company code is required"),
  address: z.string().trim().optional(),
  country: z.string().trim().optional(),
  currencyCode: z.string().trim().length(3).optional(),
  isActive: z.boolean().optional(),
});

const updateCompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").optional(),
  code: z.string().trim().min(1, "Company code is required").optional(),
  address: z.string().trim().optional(),
  country: z.string().trim().optional(),
  currencyCode: z.string().trim().length(3).optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  createCompanySchema,
  updateCompanySchema,
};