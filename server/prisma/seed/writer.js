// Turns an in-memory dataset into rows, and finds / removes seed-owned rows.
//
// Stock history is loaded with direct bulk inserts instead of the inventory
// service on purpose: the services cannot back-date createdAt (SEED-005). This
// is the one documented exception to "stock changes only through the service";
// the dataset is consistent by construction and the Inventory CHECK constraints
// plus scripts/reconcile.js verify it.
const { COMPANY_CODE, SKU_PREFIX, SUPPLIER_PREFIX, CATEGORY_PREFIX, DAY_MS } = require("./config");

const CHUNK = 1000;

// --- ownership: a row is seed-owned when it hangs off a SYN- entity ----------

const seedProduct = { sku: { startsWith: SKU_PREFIX } };
const seedSupplier = { code: { startsWith: SUPPLIER_PREFIX } };
const seedWarehouse = { factory: { company: { code: COMPANY_CODE } } };
const notSeedSupplier = { NOT: seedSupplier };

const owned = {
  inventoryTransaction: { OR: [{ product: seedProduct }, { warehouse: seedWarehouse }] },
  stockTransferItem: {
    OR: [
      { product: seedProduct },
      { transfer: { OR: [{ fromWarehouse: seedWarehouse }, { toWarehouse: seedWarehouse }] } },
    ],
  },
  stockTransfer: { OR: [{ fromWarehouse: seedWarehouse }, { toWarehouse: seedWarehouse }] },
  goodsReceiptItem: {
    OR: [
      { product: seedProduct },
      { goodsReceipt: { OR: [{ warehouse: seedWarehouse }, { purchaseOrder: { supplier: seedSupplier } }] } },
    ],
  },
  goodsReceipt: { OR: [{ warehouse: seedWarehouse }, { purchaseOrder: { supplier: seedSupplier } }] },
  purchaseInvoiceItem: { OR: [{ product: seedProduct }, { purchaseInvoice: { supplier: seedSupplier } }] },
  purchaseInvoice: { supplier: seedSupplier },
  purchaseOrderItem: { OR: [{ product: seedProduct }, { purchaseOrder: { supplier: seedSupplier } }] },
  purchaseOrder: { supplier: seedSupplier },
  inventory: { OR: [{ product: seedProduct }, { warehouse: seedWarehouse }] },
  supplierProduct: { OR: [{ product: seedProduct }, { supplier: seedSupplier }] },
  product: seedProduct,
  supplier: seedSupplier,
  category: { name: { startsWith: CATEGORY_PREFIX } },
  warehouse: seedWarehouse,
  factory: { company: { code: COMPANY_CODE } },
  company: { code: COMPANY_CODE },
};

// Deletion order respects foreign keys (children first).
const DELETE_ORDER = [
  "inventoryTransaction",
  "stockTransferItem",
  "stockTransfer",
  "goodsReceiptItem",
  "goodsReceipt",
  "purchaseInvoiceItem",
  "purchaseInvoice",
  "purchaseOrderItem",
  "purchaseOrder",
  "inventory",
  "supplierProduct",
  "product",
  "supplier",
  "category",
  "warehouse",
  "factory",
  "company",
];

// Rows outside the seed that point at seed entities. Replacing would either
// orphan or silently delete somebody else's data, so it refuses instead.
const blockerQueries = {
  "sales order items using SYN- products": (c) => c.salesOrderItem.count({ where: { product: seedProduct } }),
  "requisitions using SYN- products or suppliers": async (c) =>
    (await c.purchaseRequisitionItem.count({ where: { product: seedProduct } })) +
    (await c.purchaseRequisition.count({ where: { supplier: seedSupplier } })),
  "non-seed PO lines for SYN- products": (c) =>
    c.purchaseOrderItem.count({ where: { product: seedProduct, purchaseOrder: { supplier: notSeedSupplier } } }),
  "non-seed receipt lines for SYN- products": (c) =>
    c.goodsReceiptItem.count({
      where: { product: seedProduct, goodsReceipt: { purchaseOrder: { supplier: notSeedSupplier } } },
    }),
  "non-seed invoice lines for SYN- products": (c) =>
    c.purchaseInvoiceItem.count({ where: { product: seedProduct, purchaseInvoice: { supplier: notSeedSupplier } } }),
  "stock of SYN- products outside the SYN- warehouses": async (c) =>
    (await c.inventory.count({ where: { product: seedProduct, warehouse: { NOT: seedWarehouse } } })) +
    (await c.inventoryTransaction.count({ where: { product: seedProduct, warehouse: { NOT: seedWarehouse } } })),
  "manual transfers touching the SYN- warehouses": (c) =>
    c.stockTransfer.count({
      where: { ...owned.stockTransfer, NOT: { transferNumber: { startsWith: "TRF-SYN-" } } },
    }),
  "manual goods receipts into the SYN- warehouses": (c) =>
    c.goodsReceipt.count({
      where: { warehouse: seedWarehouse, purchaseOrder: { supplier: notSeedSupplier } },
    }),
};

const describeSeedData = async (client) => {
  const counts = {};
  let total = 0;

  for (const model of DELETE_ORDER) {
    counts[model] = await client[model].count({ where: owned[model] });
    total += counts[model];
  }

  return { counts, total };
};

const findBlockers = async (client) => {
  const blockers = [];

  for (const [label, query] of Object.entries(blockerQueries)) {
    const count = await query(client);

    if (count > 0) {
      blockers.push({ label, count });
    }
  }

  return blockers;
};

const replaceSeedData = async (prisma) =>
  prisma.$transaction(
    async (tx) => {
      const deleted = {};

      for (const model of DELETE_ORDER) {
        const result = await tx[model].deleteMany({ where: owned[model] });
        deleted[model] = result.count;
      }

      return deleted;
    },
    { timeout: 120000, maxWait: 10000 }
  );

// --- writing -----------------------------------------------------------------

const chunks = (items, size = CHUNK) => {
  const out = [];

  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }

  return out;
};

const keyBy = (rows, key) => new Map(rows.map((row) => [row[key], row]));

const writeDataset = async (prisma, dataset) => {
  // master data predates the history by a week, deterministically
  const masterAt = new Date(Date.parse(`${dataset.meta.startDate}T00:00:00Z`) - 7 * DAY_MS);

  return prisma.$transaction(
    async (tx) => {
      const company = await tx.company.create({
        data: { ...dataset.company, createdAt: masterAt, updatedAt: masterAt },
      });
      const factory = await tx.factory.create({
        data: { ...dataset.factory, companyId: company.id, createdAt: masterAt, updatedAt: masterAt },
      });
      const warehouses = keyBy(
        await tx.warehouse.createManyAndReturn({
          data: dataset.warehouses.map((w) => ({ ...w, factoryId: factory.id, createdAt: masterAt, updatedAt: masterAt })),
        }),
        "code"
      );
      const categories = keyBy(
        await tx.category.createManyAndReturn({
          data: dataset.categories.map((name) => ({ name, createdAt: masterAt, updatedAt: masterAt })),
        }),
        "name"
      );
      const suppliers = keyBy(
        await tx.supplier.createManyAndReturn({
          data: dataset.suppliers.map((s) => ({ ...s, createdAt: masterAt, updatedAt: masterAt })),
        }),
        "code"
      );
      const products = keyBy(
        await tx.product.createManyAndReturn({
          data: dataset.products.map((p) => ({
            sku: p.sku,
            name: p.name,
            price: p.price,
            unit: p.unit,
            categoryId: categories.get(p.categoryName).id,
            reorderLevel: p.reorderLevel,
            minStock: p.minStock,
            maxStock: p.maxStock,
            createdAt: masterAt,
            updatedAt: masterAt,
          })),
        }),
        "sku"
      );

      await tx.supplierProduct.createMany({
        data: dataset.supplierProducts.map((sp) => ({
          supplierId: suppliers.get(sp.supplierCode).id,
          productId: products.get(sp.sku).id,
          supplierSku: sp.supplierSku,
          unitPrice: sp.unitPrice,
          leadTimeDays: sp.leadTimeDays,
          minimumOrderQty: sp.minimumOrderQty,
          isPreferred: sp.isPreferred,
          createdAt: masterAt,
          updatedAt: masterAt,
        })),
      });

      // purchase orders, their lines and goods receipts
      const orders = keyBy(
        await tx.purchaseOrder.createManyAndReturn({
          data: dataset.purchaseOrders.map((po) => ({
            poNumber: po.number,
            supplierId: suppliers.get(po.supplierCode).id,
            destinationWarehouseId: warehouses.get(po.receivingWarehouseCode).id,
            status: po.status,
            orderDate: new Date(po.createdAt),
            expectedDate: new Date(po.expectedAt),
            notes: po.notes,
            subtotal: po.subtotal,
            taxAmount: po.taxAmount,
            totalAmount: po.totalAmount,
            createdAt: new Date(po.createdAt),
            updatedAt: new Date(po.createdAt),
          })),
        }),
        "poNumber"
      );

      const orderItemByPo = new Map();

      for (const batch of chunks(dataset.purchaseOrders)) {
        const rows = await tx.purchaseOrderItem.createManyAndReturn({
          data: batch.map((po) => ({
            purchaseOrderId: orders.get(po.number).id,
            productId: products.get(po.item.sku).id,
            quantity: po.item.quantity,
            receivedQuantity: po.item.receivedQuantity,
            unitPrice: po.item.unitPrice,
            lineTotal: po.item.lineTotal,
          })),
        });

        batch.forEach((po, i) => orderItemByPo.set(po.number, rows[i]));
      }

      const receipts = keyBy(
        await tx.goodsReceipt.createManyAndReturn({
          data: dataset.goodsReceipts.map((gr) => ({
            receiptNumber: gr.number,
            purchaseOrderId: orders.get(gr.purchaseOrderNumber).id,
            warehouseId: warehouses.get(gr.warehouseCode).id,
            status: "RECEIVED",
            receiptDate: new Date(gr.receivedAt),
            createdAt: new Date(gr.receivedAt),
            updatedAt: new Date(gr.receivedAt),
          })),
        }),
        "receiptNumber"
      );

      await tx.goodsReceiptItem.createMany({
        data: dataset.goodsReceipts.map((gr) => ({
          goodsReceiptId: receipts.get(gr.number).id,
          purchaseOrderItemId: orderItemByPo.get(gr.purchaseOrderNumber).id,
          productId: products.get(gr.sku).id,
          quantity: gr.quantity,
        })),
      });

      // transfers
      const transfers = keyBy(
        await tx.stockTransfer.createManyAndReturn({
          data: dataset.transfers.map((t) => ({
            transferNumber: t.number,
            fromWarehouseId: warehouses.get(t.fromWarehouseCode).id,
            toWarehouseId: warehouses.get(t.toWarehouseCode).id,
            status: "COMPLETED",
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.createdAt),
          })),
        }),
        "transferNumber"
      );

      await tx.stockTransferItem.createMany({
        data: dataset.transfers.map((t) => ({
          transferId: transfers.get(t.number).id,
          productId: products.get(t.sku).id,
          quantity: t.quantity,
        })),
      });

      // the ledger, in chronological order so ids grow with time
      const referenceId = (reference) => {
        if (!reference) return null;

        return reference.type === "GOODS_RECEIPT"
          ? receipts.get(reference.number).id
          : transfers.get(reference.number).id;
      };

      for (const batch of chunks(dataset.ledger)) {
        await tx.inventoryTransaction.createMany({
          data: batch.map((row) => ({
            productId: products.get(row.sku).id,
            warehouseId: warehouses.get(row.warehouseCode).id,
            type: row.type,
            quantity: row.quantity,
            balanceAfter: row.balanceAfter,
            reservedAfter: row.reservedAfter,
            referenceType: row.referenceType,
            referenceId: referenceId(row.reference),
            reason: row.reason,
            createdAt: new Date(row.createdAt),
          })),
        });
      }

      await tx.inventory.createMany({
        data: dataset.inventory.map((inv) => ({
          productId: products.get(inv.sku).id,
          warehouseId: warehouses.get(inv.warehouseCode).id,
          quantity: inv.quantity,
          reservedQuantity: inv.reservedQuantity,
          createdAt: new Date(inv.createdAt),
          updatedAt: new Date(inv.updatedAt),
        })),
      });

      return {
        company: 1,
        factory: 1,
        warehouse: dataset.warehouses.length,
        category: dataset.categories.length,
        product: dataset.products.length,
        supplier: dataset.suppliers.length,
        supplierProduct: dataset.supplierProducts.length,
        purchaseOrder: dataset.purchaseOrders.length,
        goodsReceipt: dataset.goodsReceipts.length,
        stockTransfer: dataset.transfers.length,
        inventoryTransaction: dataset.ledger.length,
        inventory: dataset.inventory.length,
      };
    },
    { timeout: 120000, maxWait: 10000 }
  );
};

module.exports = { writeDataset, replaceSeedData, describeSeedData, findBlockers, DELETE_ORDER };
