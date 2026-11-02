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
const { requireRole } = require("../middlewares/auth.middleware");
const roles = require("../middlewares/roles");
const {
  createRequisitionSchema,
  createPurchaseOrderSchema,
  createGoodsReceiptSchema,
  createPurchaseInvoiceSchema,
} = require("../validators/procurement.validator");

const router = express.Router();

router.post("/requisitions", requireRole(...roles.PROCUREMENT), validate(createRequisitionSchema), createRequisition);
router.get("/requisitions", getRequisitions);

router.post("/requisitions/:id/submit", requireRole(...roles.PROCUREMENT), submitRequisition);
router.post("/requisitions/:id/approve", requireRole(...roles.PROCUREMENT), approveRequisition);

router.post("/purchase-orders", requireRole(...roles.PROCUREMENT), validate(createPurchaseOrderSchema), createPurchaseOrder);
router.get("/purchase-orders", getPurchaseOrders);

router.post("/purchase-orders/:id/approve", requireRole(...roles.PROCUREMENT), approvePurchaseOrder);

router.post("/goods-receipts", requireRole(...roles.GOODS_RECEIPT), validate(createGoodsReceiptSchema), createGoodsReceipt);
router.get("/goods-receipts", getGoodsReceipts);

router.post("/purchase-invoices", requireRole(...roles.PROCUREMENT), validate(createPurchaseInvoiceSchema), createPurchaseInvoice);
router.get("/purchase-invoices", getPurchaseInvoices);

module.exports = router;