const { z } = require("zod");

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

const demoLoginSchema = z
  .object({
    role: z.enum(["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER", "VIEWER"]),
  })
  .strict();

module.exports = { loginSchema, demoLoginSchema };
