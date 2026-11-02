const express = require("express");

const {
  createSupplierProduct,
  getAllSupplierProducts,
  getSupplierProductById,
  updateSupplierProduct,
} = require("../controllers/supplier-product.controller");

const router = express.Router();

router.post("/", createSupplierProduct);
router.get("/", getAllSupplierProducts);
router.get("/:id", getSupplierProductById);
router.patch("/:id", updateSupplierProduct);

module.exports = router;