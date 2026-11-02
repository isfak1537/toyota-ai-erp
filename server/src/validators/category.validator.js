const { z } = require("zod");

const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Category name is required"),
});

const updateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Category name cannot be empty")
    .optional(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
};