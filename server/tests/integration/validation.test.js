const request = require("supertest");

const app = require("../../src/app");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const api = () => request(app);

beforeEach(resetDatabase);
afterAll(disconnect);

const counts = async () => ({
  inventory: await prisma.inventory.count(),
  ledger: await prisma.inventoryTransaction.count(),
  transfers: await prisma.stockTransfer.count(),
  requisitions: await prisma.purchaseRequisition.count(),
  orders: await prisma.purchaseOrder.count(),
  receipts: await prisma.goodsReceipt.count(),
  invoices: await prisma.purchaseInvoice.count(),
});

const expectRejected = async (path, body, field, status = 400) => {
  const before = await counts();
  const res = await api().post(path).send(body);

  expect(res.status).toBe(status);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toBe("Validation failed");
  expect(Object.keys(res.body.errors)).toContain(field);
  expect(await counts()).toEqual(before);

  return res;
};

describe("inventory write validation (D-07)", () => {
  let s;

  beforeEach(async () => {
    s = await f.stockScenario({ quantity: 10 });
  });

  const ids = () => ({ productId: s.product.id, warehouseId: s.warehouse.id });

  it.each([
    ["receive", "quantity", 0],
    ["receive", "quantity", -5],
    ["receive", "quantity", 1.5],
    ["receive", "quantity", "abc"],
    ["receive", "quantity", 1e12],
    ["issue", "quantity", 0],
    ["reserve", "quantity", null],
    ["release", "quantity", undefined],
    ["adjust", "quantity", 0],
    ["adjust", "quantity", 0.5],
  ])("%s rejects %s = %p", async (operation, field, value) => {
    await expectRejected(`/api/v1/inventory/${operation}`, { ...ids(), [field]: value }, field);
  });

  it.each(["receive", "issue", "adjust", "reserve", "release"])(
    "%s rejects missing and malformed ids and unknown fields",
    async (operation) => {
      await expectRejected(`/api/v1/inventory/${operation}`, { warehouseId: 1, quantity: 1 }, "productId");
      await expectRejected(`/api/v1/inventory/${operation}`, { productId: "x", warehouseId: 1, quantity: 1 }, "productId");
      await expectRejected(`/api/v1/inventory/${operation}`, { productId: 1, warehouseId: -1, quantity: 1 }, "warehouseId");
      await expectRejected(`/api/v1/inventory/${operation}`, { ...ids(), quantity: 1, id: 99 }, "id");
    }
  );

  it("accepts numeric strings for ids and quantity", async () => {
    const res = await api()
      .post("/api/v1/inventory/receive")
      .send({ productId: String(s.product.id), warehouseId: String(s.warehouse.id), quantity: "5" });

    expect(res.status).toBe(201);
    expect(res.body.data.inventory.quantity).toBe(15);
  });

  it("accepts a negative adjustment and rejects an oversized free-text reason", async () => {
    await api().post("/api/v1/inventory/adjust").send({ ...ids(), quantity: -3 }).expect(201);
    await expectRejected("/api/v1/inventory/adjust", { ...ids(), quantity: 1, reason: "x".repeat(300) }, "reason");
  });

  it("create rejects reserved above quantity and unknown fields", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const base = { productId: product.id, warehouseId: warehouse.id };

    await expectRejected("/api/v1/inventory", { ...base, quantity: 1, reservedQuantity: 2 }, "reservedQuantity");
    await expectRejected("/api/v1/inventory", { ...base, createdAt: "2020-01-01" }, "createdAt");
    await expectRejected("/api/v1/inventory", { ...base, quantity: -1 }, "quantity");
  });
});

describe("stock transfer write validation (D-07)", () => {
  it("rejects bad bodies with field details and writes nothing", async () => {
    const s = await f.stockScenario({ quantity: 10 });
    const to = await f.createWarehouse();
    const ok = { fromWarehouseId: s.warehouse.id, toWarehouseId: to.id };

    await expectRejected("/api/v1/stock-transfers", {}, "fromWarehouseId");
    await expectRejected("/api/v1/stock-transfers", { ...ok, items: [] }, "items");
    await expectRejected("/api/v1/stock-transfers", { ...ok, items: "nope" }, "items");
    await expectRejected(
      "/api/v1/stock-transfers",
      { fromWarehouseId: s.warehouse.id, toWarehouseId: s.warehouse.id, items: [{ productId: s.product.id, quantity: 1 }] },
      "toWarehouseId"
    );
    await expectRejected(
      "/api/v1/stock-transfers",
      { ...ok, items: [{ productId: s.product.id, quantity: 0 }] },
      "items.0.quantity"
    );
    await expectRejected(
      "/api/v1/stock-transfers",
      { ...ok, items: [{ productId: s.product.id, quantity: 1 }, { productId: s.product.id, quantity: 2 }] },
      "items"
    );
    await expectRejected("/api/v1/stock-transfers", { ...ok, items: [{ productId: s.product.id, quantity: 1, price: 5 }] }, "items.0.price");
  });
});

describe("procurement write validation (D-07)", () => {
  let product;
  let supplier;

  beforeEach(async () => {
    product = await f.createProduct();
    supplier = await f.createSupplier();
  });

  const line = (extra = {}) => ({ productId: product.id, quantity: 1, unitPrice: 5, ...extra });

  it("requisitions", async () => {
    const item = { productId: product.id, quantity: 1, estimatedUnitPrice: 5 };

    await expectRejected("/api/v1/procurement/requisitions", {}, "requesterName");
    await expectRejected("/api/v1/procurement/requisitions", { requesterName: "  ", items: [item] }, "requesterName");
    await expectRejected("/api/v1/procurement/requisitions", { requesterName: "A", items: [] }, "items");
    await expectRejected("/api/v1/procurement/requisitions", { requesterName: "A", items: [{ ...item, estimatedUnitPrice: -1 }] }, "items.0.estimatedUnitPrice");
    await expectRejected("/api/v1/procurement/requisitions", { requesterName: "A", items: [{ ...item, estimatedUnitPrice: "abc" }] }, "items.0.estimatedUnitPrice");
    await expectRejected("/api/v1/procurement/requisitions", { requesterName: "A", items: [item, item] }, "items");
    await expectRejected("/api/v1/procurement/requisitions", { requesterName: "A", status: "APPROVED", items: [item] }, "status");
  });

  it("purchase orders", async () => {
    await expectRejected("/api/v1/procurement/purchase-orders", { items: [line()] }, "supplierId");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, items: [] }, "items");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, items: [line({ quantity: 0 })] }, "items.0.quantity");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, items: [line({ unitPrice: undefined })] }, "items.0.unitPrice");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, taxAmount: -1, items: [line()] }, "taxAmount");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, expectedDate: "tomorrow-ish", items: [line()] }, "expectedDate");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, items: [line({ unitPrice: 1e11 })] }, "items.0.unitPrice");
    await expectRejected("/api/v1/procurement/purchase-orders", { supplierId: supplier.id, status: "APPROVED", items: [line()] }, "status");
  });

  it("goods receipts", async () => {
    const item = { purchaseOrderItemId: 1, productId: product.id, quantity: 1 };

    await expectRejected("/api/v1/procurement/goods-receipts", {}, "purchaseOrderId");
    await expectRejected("/api/v1/procurement/goods-receipts", { purchaseOrderId: 1, warehouseId: 1, items: [] }, "items");
    await expectRejected("/api/v1/procurement/goods-receipts", { purchaseOrderId: 1, warehouseId: 1, items: [{ ...item, quantity: -2 }] }, "items.0.quantity");
    await expectRejected("/api/v1/procurement/goods-receipts", { purchaseOrderId: 1, warehouseId: 1, items: [{ productId: product.id, quantity: 1 }] }, "items.0.purchaseOrderItemId");
  });

  it("purchase invoices", async () => {
    await expectRejected("/api/v1/procurement/purchase-invoices", { supplierId: supplier.id, items: [line()] }, "invoiceNumber");
    await expectRejected("/api/v1/procurement/purchase-invoices", { invoiceNumber: "I", supplierId: supplier.id, items: [] }, "items");
    await expectRejected("/api/v1/procurement/purchase-invoices", { invoiceNumber: "I", supplierId: supplier.id, paidAmount: -1, items: [line()] }, "paidAmount");
    await expectRejected("/api/v1/procurement/purchase-invoices", { invoiceNumber: "I", supplierId: supplier.id, dueDate: "never", items: [line()] }, "dueDate");
  });

  it("accepts string money, null/empty optionals and returns the same envelope as before", async () => {
    const res = await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        requisitionId: "",
        expectedDate: null,
        notes: "",
        taxAmount: "0.07",
        items: [line({ unitPrice: "12.50", quantity: "2" })],
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, message: "Purchase order created successfully" });
    expect(res.body.data.status).toBe("PENDING_APPROVAL");
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(25.07, 2);
  });
});
