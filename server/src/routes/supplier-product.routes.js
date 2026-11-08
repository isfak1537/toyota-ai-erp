const express = require("express");

const {
  createSupplierProduct,
  getAllSupplierProducts,
  getSupplierProductById,
  updateSupplierProduct,
} = require("../controllers/supplier-product.controller");

const validate = require("../middlewares/validate.middleware");
const {
  createSupplierProductSchema,
  updateSupplierProductSchema,
} = require("../validators/supplier-product.validator");

const router = express.Router();

router.post("/", validate(createSupplierProductSchema), createSupplierProduct);
router.get("/", getAllSupplierProducts);
router.get("/:id", getSupplierProductById);
router.patch("/:id", validate(updateSupplierProductSchema), updateSupplierProduct);

module.exports = router;