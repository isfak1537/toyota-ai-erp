const { z } = require("zod");

const createCustomerSchema = z.object({
  customerCode: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(150),

  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  taxNumber: z.string().trim().max(100).optional(),

  creditLimit: z.coerce.number().min(0).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),

  companyId: z.coerce.number().int().positive().optional(),
});

const updateCustomerSchema = createCustomerSchema
  .partial()
  .omit({
    customerCode: true,
    companyId: true,
  });

module.exports = {
  createCustomerSchema,
  updateCustomerSchema,
};