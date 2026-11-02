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

const validate = require("../middlewares/validate.middleware");
const {
  createRequisitionSchema,
  createPurchaseOrderSchema,
  createGoodsReceiptSchema,
  createPurchaseInvoiceSchema,
} = require("../validators/procurement.validator");

const router = express.Router();

router.post("/requisitions", validate(createRequisitionSchema), createRequisition);
router.get("/requisitions", getRequisitions);

router.post("/requisitions/:id/submit", submitRequisition);
router.post("/requisitions/:id/approve", approveRequisition);

router.post("/purchase-orders", validate(createPurchaseOrderSchema), createPurchaseOrder);
router.get("/purchase-orders", getPurchaseOrders);

router.post("/purchase-orders/:id/approve", approvePurchaseOrder);

router.post("/goods-receipts", validate(createGoodsReceiptSchema), createGoodsReceipt);
router.get("/goods-receipts", getGoodsReceipts);

router.post("/purchase-invoices", validate(createPurchaseInvoiceSchema), createPurchaseInvoice);
router.get("/purchase-invoices", getPurchaseInvoices);

module.exports = router;