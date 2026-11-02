const { z } = require("zod");
const {
  MAX_UNIT_PRICE,
  positiveInt,
  quantity,
  optionalId,
  money,
  optionalMoney,
  text,
  optionalText,
  optionalDate,
  uniqueProducts,
} = require("./common.validator");

const itemsOf = (shape, emptyMessage) =>
  z
    .array(z.strictObject(shape), { error: "items must be an array" })
    .min(1, emptyMessage)
    .max(200, "At most 200 items are allowed");

const createRequisitionSchema = z
  .strictObject({
    requesterName: text("requesterName", 120).min(1, "requesterName is required"),
    supplierId: optionalId("supplierId"),
    destinationWarehouseId: optionalId("destinationWarehouseId"),
    notes: optionalText("notes"),
    items: itemsOf(
      {
        productId: positiveInt("productId"),
        quantity: quantity("quantity"),
        estimatedUnitPrice: money("estimatedUnitPrice", MAX_UNIT_PRICE),
      },
      "At least one requisition item is required"
    ),
  })
  .superRefine(
    uniqueProducts((id) => `Product ${id} appears more than once in the requisition`)
  );

const createPurchaseOrderSchema = z
  .strictObject({
    supplierId: positiveInt("supplierId"),
    requisitionId: optionalId("requisitionId"),
    destinationWarehouseId: optionalId("destinationWarehouseId"),
    expectedDate: optionalDate("expectedDate"),
    notes: optionalText("notes"),
    taxAmount: optionalMoney("taxAmount"),
    items: itemsOf(
      {
        productId: positiveInt("productId"),
        quantity: quantity("quantity"),
        unitPrice: money("unitPrice", MAX_UNIT_PRICE),
      },
      "At least one purchase order item is required"
    ),
  })
  .superRefine(
    uniqueProducts((id) => `Product ${id} appears more than once in the purchase order`)
  );

const createGoodsReceiptSchema = z
  .strictObject({
    purchaseOrderId: positiveInt("purchaseOrderId"),
    // optional when the purchase order has a destination warehouse (it is then the default)
    warehouseId: optionalId("warehouseId"),
    // receive somewhere other than the PO's destination (ADMIN, WAREHOUSE_MANAGER; audited)
    allowDifferentWarehouse: z.boolean({ error: "allowDifferentWarehouse must be true or false" }).optional(),
    notes: optionalText("notes"),
    items: itemsOf(
      {
        purchaseOrderItemId: positiveInt("purchaseOrderItemId"),
        productId: positiveInt("productId"),
        quantity: quantity("quantity"),
      },
      "At least one goods receipt item is required"
    ),
  })
  .superRefine(
    uniqueProducts((id) => `Product ${id} appears more than once in the goods receipt`)
  );

const createPurchaseInvoiceSchema = z
  .strictObject({
    invoiceNumber: text("invoiceNumber", 100).min(1, "invoiceNumber is required"),
    supplierId: positiveInt("supplierId"),
    purchaseOrderId: optionalId("purchaseOrderId"),
    dueDate: optionalDate("dueDate"),
    taxAmount: optionalMoney("taxAmount"),
    paidAmount: optionalMoney("paidAmount"),
    notes: optionalText("notes"),
    items: itemsOf(
      {
        productId: positiveInt("productId"),
        quantity: quantity("quantity"),
        unitPrice: money("unitPrice", MAX_UNIT_PRICE),
      },
      "At least one purchase invoice item is required"
    ),
  })
  .superRefine(
    uniqueProducts((id) => `Product ${id} appears more than once in the invoice`)
  );

module.exports = {
  createRequisitionSchema,
  createPurchaseOrderSchema,
  createGoodsReceiptSchema,
  createPurchaseInvoiceSchema,
};
