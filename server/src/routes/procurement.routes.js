const express = require("express");

const {
  createRequisition,
  getRequisitions,
  submitRequisition,
  approveRequisition,
  createPurchaseOrder,
  getPurchaseOrders,
  approvePurchaseOrder,
  createGoodsReceipt,
  getGoodsReceipts,
  createPurchaseInvoice,
  getPurchaseInvoices,
} = require("../controllers/procurement.controller");

const router = express.Router();

router.post("/requisitions", createRequisition);
router.get("/requisitions", getRequisitions);

router.post("/requisitions/:id/submit", submitRequisition);
router.post("/requisitions/:id/approve", approveRequisition);

router.post("/purchase-orders", createPurchaseOrder);
router.get("/purchase-orders", getPurchaseOrders);

router.post("/purchase-orders/:id/approve", approvePurchaseOrder);

router.post("/goods-receipts", createGoodsReceipt);
router.get("/goods-receipts", getGoodsReceipts);

router.post("/purchase-invoices", createPurchaseInvoice);
router.get("/purchase-invoices", getPurchaseInvoices);

module.exports = router;