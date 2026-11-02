const express = require("express");

const {
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  deleteInventory,
  receiveStock,
  issueStock,
  adjustStock,
  reserveStock,
  releaseStock,
  getTransactions,
  getLowStock,
} = require("../controllers/inventory.controller");

const validate = require("../middlewares/validate.middleware");
const {
  createInventorySchema,
  updateInventorySchema,
  receiveStockSchema,
  issueStockSchema,
  adjustStockSchema,
  reserveStockSchema,
  releaseStockSchema,
} = require("../validators/inventory.validator");

const router = express.Router();

router.post("/", validate(createInventorySchema), createInventory);

router.post("/receive", validate(receiveStockSchema), receiveStock);
router.post("/issue", validate(issueStockSchema), issueStock);
router.post("/adjust", validate(adjustStockSchema), adjustStock);
router.post("/reserve", validate(reserveStockSchema), reserveStock);
router.post("/release", validate(releaseStockSchema), releaseStock);

router.get("/transactions", getTransactions);
router.get("/low-stock", getLowStock);

router.get("/", getAllInventory);
router.get("/:id", getInventoryById);

router.patch("/:id", validate(updateInventorySchema), updateInventory);
router.delete("/:id", deleteInventory);

module.exports = router;