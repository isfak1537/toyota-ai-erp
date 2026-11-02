const express = require("express");

const supplierController = require("../controllers/supplier.controller");
const validate = require("../middlewares/validate.middleware");

const {
  createSupplierSchema,
  updateSupplierSchema,
} = require("../validators/supplier.validator");

const router = express.Router();

router.post(
  "/",
  validate(createSupplierSchema),
  supplierController.createSupplier
);

router.get(
  "/",
  supplierController.getAllSuppliers
);

router.get(
  "/:id",
  supplierController.getSupplierById
);

router.patch(
  "/:id",
  validate(updateSupplierSchema),
  supplierController.updateSupplier
);

router.delete(
  "/:id",
  supplierController.deleteSupplier
);

module.exports = router;