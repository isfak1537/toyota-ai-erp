const request = require("supertest");

const app = require("../../src/app");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile } = require("../helpers/ledger");

const api = () => request(app);

beforeEach(resetDatabase);
afterAll(disconnect);

const receiptBody = (po, warehouse, quantity) => ({
  purchaseOrderId: po.id,
  warehouseId: warehouse.id,
  items: [
    {
      purchaseOrderItemId: po.items[0].id,
      productId: po.items[0].productId,
      quantity,
    },
  ],
});

describe("procure-to-stock chain (PRD 9.1)", () => {
  it("runs requisition -> PO -> goods receipt and updates stock and ledger", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();
    const warehouse = await f.createWarehouse();

    const requisition = await api()
      .post("/api/v1/procurement/requisitions")
      .send({
        requesterName: "Tester",
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 10, estimatedUnitPrice: 5 }],
      })
      .expect(201);
    const requisitionId = requisition.body.data.id;

    await api().post(`/api/v1/procurement/requisitions/${requisitionId}/submit`).expect(200);
    await api().post(`/api/v1/procurement/requisitions/${requisitionId}/approve`).expect(200);

    const order = await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        requisitionId,
        items: [{ productId: product.id, quantity: 10, unitPrice: 5 }],
      })
      .expect(201);
    const po = order.body.data;
    expect(po.status).toBe("PENDING_APPROVAL");

    await api().post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).expect(200);

    const first = await api()
      .post("/api/v1/procurement/goods-receipts")
      .send({
        purchaseOrderId: po.id,
        warehouseId: warehouse.id,
        items: [{ purchaseOrderItemId: po.items[0].id, productId: product.id, quantity: 4 }],
      })
      .expect(201);
    expect(first.body.data.items).toHaveLength(1);
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");

    await api()
      .post("/api/v1/procurement/goods-receipts")
      .send({
        purchaseOrderId: po.id,
        warehouseId: warehouse.id,
        items: [{ purchaseOrderItemId: po.items[0].id, productId: product.id, quantity: 6 }],
      })
      .expect(201);

    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("RECEIVED");
    const { inventory, rows } = await reconcile(product.id, warehouse.id, 0);
    expect(inventory.quantity).toBe(10);
    expect(rows.map((r) => r.balanceAfter)).toEqual([4, 10]);
  });
});

describe("procurement writes: 409 mappings", () => {
  it("rejects submitting a requisition that is not DRAFT", async () => {
    const requisition = await f.createRequisition({ status: "APPROVED" });

    const res = await api().post(`/api/v1/procurement/requisitions/${requisition.id}/submit`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Only DRAFT requisitions can be submitted");
  });

  it("rejects approving a requisition that is not SUBMITTED", async () => {
    const requisition = await f.createRequisition({ status: "DRAFT" });

    const res = await api().post(`/api/v1/procurement/requisitions/${requisition.id}/approve`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Only SUBMITTED requisitions can be approved");
  });

  it("rejects creating a PO from a requisition that is not APPROVED", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();
    const requisition = await f.createRequisition({
      status: "SUBMITTED",
      items: [{ productId: product.id, quantity: 5 }],
    });

    const res = await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        requisitionId: requisition.id,
        items: [{ productId: product.id, quantity: 5, unitPrice: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Purchase order can only be created from an APPROVED requisition");
  });

  it("rejects approving a PO that is not PENDING_APPROVAL", async () => {
    const product = await f.createProduct();
    const po = await f.createPurchaseOrder({
      status: "APPROVED",
      items: [{ productId: product.id, quantity: 5 }],
    });

    const res = await api().post(`/api/v1/procurement/purchase-orders/${po.id}/approve`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Only PENDING_APPROVAL purchase orders can be approved");
  });

  it("rejects a goods receipt against a PO that is not receivable", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({
      status: "PENDING_APPROVAL",
      items: [{ productId: product.id, quantity: 5 }],
    });

    const res = await api().post("/api/v1/procurement/goods-receipts").send(receiptBody(po, warehouse, 1));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/requires an APPROVED or PARTIALLY_RECEIVED/);
  });

  it("rejects receiving an item that is already fully received", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({
      status: "PARTIALLY_RECEIVED",
      items: [{ productId: product.id, quantity: 5, receivedQuantity: 5 }],
    });

    const res = await api().post("/api/v1/procurement/goods-receipts").send(receiptBody(po, warehouse, 1));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/has already been fully received/);
  });

  it("rejects receiving more than the remaining quantity and leaves stock untouched", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({
      status: "PARTIALLY_RECEIVED",
      items: [{ productId: product.id, quantity: 10, receivedQuantity: 4 }],
    });

    const res = await api().post("/api/v1/procurement/goods-receipts").send(receiptBody(po, warehouse, 7));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Cannot receive 7\. Remaining quantity .* is 6/);
    expect(await prisma.goodsReceipt.count()).toBe(0);
    expect(await prisma.inventory.count()).toBe(0);
  });

  it("rejects an invoice for a cancelled PO", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();
    const po = await f.createPurchaseOrder({
      status: "CANCELLED",
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5 }],
    });

    const res = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({
        invoiceNumber: "INV-1",
        supplierId: supplier.id,
        purchaseOrderId: po.id,
        items: [{ productId: product.id, quantity: 1, unitPrice: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Cannot create invoice for a cancelled purchase order");
  });

  it("rejects paidAmount above the invoice total as a 400 (request fields only)", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();

    const res = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({
        invoiceNumber: "INV-2",
        supplierId: supplier.id,
        paidAmount: 100,
        items: [{ productId: product.id, quantity: 1, unitPrice: 1 }],
      });

    expect(res.status).toBe(400);
    expect(await prisma.purchaseInvoice.count()).toBe(0);
  });
});
