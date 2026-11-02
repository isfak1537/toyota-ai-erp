// Who may write what (SRS 2.2 and 6, AUTH-001). Reads need any valid login.
const ADMIN = "ADMIN";
const WAREHOUSE_MANAGER = "WAREHOUSE_MANAGER";
const PROCUREMENT_OFFICER = "PROCUREMENT_OFFICER";

module.exports = {
  // master data: company, factory, warehouse, category, product, customer, sales order
  MASTER_DATA: [ADMIN],
  // inventory operations, stock transfers, ledger-changing actions
  STOCK: [ADMIN, WAREHOUSE_MANAGER],
  // suppliers, supplier products, requisitions, purchase orders, invoices, replenishment
  PROCUREMENT: [ADMIN, PROCUREMENT_OFFICER],
  // goods receipts add stock from a purchase order
  GOODS_RECEIPT: [ADMIN, WAREHOUSE_MANAGER, PROCUREMENT_OFFICER],
  ANOMALY_REVIEW: [ADMIN, WAREHOUSE_MANAGER],
  ADMIN_ONLY: [ADMIN],
};
