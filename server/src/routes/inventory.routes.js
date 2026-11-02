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

const router = express.Router();

router.post("/", createInventory);

router.post("/receive", receiveStock);
router.post("/issue", issueStock);
router.post("/adjust", adjustStock);
router.post("/reserve", reserveStock);
router.post("/release", releaseStock);

router.get("/transactions", getTransactions);
router.get("/low-stock", getLowStock);

router.get("/", getAllInventory);
router.get("/:id", getInventoryById);

router.patch("/:id", updateInventory);
router.delete("/:id", deleteInventory);

module.exports = router;