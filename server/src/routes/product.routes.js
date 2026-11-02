const express = require("express");

const productController = require("../controllers/product.controller");
const validate = require("../middlewares/validate.middleware");

const {
  createProductSchema,
  updateProductSchema,
} = require("../validators/product.validator");

const router = express.Router();

router.post(
  "/",
  validate(createProductSchema),
  productController.createProduct
);

router.get("/", productController.getAllProducts);

router.get("/:id", productController.getProductById);

router.patch(
  "/:id",
  validate(updateProductSchema),
  productController.updateProduct
);

router.delete("/:id", productController.deleteProduct);

module.exports = router;