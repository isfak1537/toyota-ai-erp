const express = require("express");

const categoryController = require("../controllers/category.controller");
const validate = require("../middlewares/validate.middleware");

const {
  createCategorySchema,
  updateCategorySchema,
} = require("../validators/category.validator");

const router = express.Router();

router.post(
  "/",
  validate(createCategorySchema),
  categoryController.createCategory
);

router.get(
  "/",
  categoryController.getAllCategories
);

router.get(
  "/:id",
  categoryController.getCategoryById
);

router.patch(
  "/:id",
  validate(updateCategorySchema),
  categoryController.updateCategory
);

router.delete(
  "/:id",
  categoryController.deleteCategory
);

module.exports = router;