const express = require("express");

const {
  createSalesOrder,
  getAllSalesOrders,
  getSalesOrderById,
  confirmSalesOrder,
  cancelSalesOrder,
} = require("../controllers/sales-order.controller");

const router = express.Router();

router.post("/", createSalesOrder);

router.get("/", getAllSalesOrders);

router.get("/:id", getSalesOrderById);

router.post("/:id/confirm", confirmSalesOrder);

router.post("/:id/cancel", cancelSalesOrder);

module.exports = router;