const express = require("express");

const validate = require("../middlewares/validate.middleware");

const {
  createWarehouseSchema,
  updateWarehouseSchema,
} = require("../validators/warehouse.validator");

const warehouseController = require("../controllers/warehouse.controller");

const router = express.Router();

router.post(
  "/",
  validate(createWarehouseSchema),
  warehouseController.createWarehouse
);

router.get("/", warehouseController.getAllWarehouses);

router.get("/:id", warehouseController.getWarehouseById);

router.patch(
  "/:id",
  validate(updateWarehouseSchema),
  warehouseController.updateWarehouse
);

router.delete("/:id", warehouseController.deleteWarehouse);

module.exports = router;