const request = require("supertest");

const app = require("../../src/app");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const api = () => request(app);

beforeEach(resetDatabase);
afterAll(disconnect);

const N = 5;

// Each seeder creates N rows for one list endpoint.
const seeders = {
  inventory: async () => {
    const warehouse = await f.createWarehouse();
    for (let i = 0; i < N; i += 1) {
      const product = await f.createProduct();
      await f.createInventory({ productId: product.id, warehouseId: warehouse.id, quantity: 10 + i });
    }
  },
  transactions: async () => {
    const s = await f.stockScenario({ quantity: 100 });
    for (let i = 0; i < N; i += 1) {
      await prisma.inventoryTransaction.create({
        data: {
          productId: s.product.id,
          warehouseId: s.warehouse.id,
          type: "RECEIPT",
          quantity: 1,
          balanceAfter: 100 + i,
        },
      });
    }
  },
  lowStock: async () => {
    const warehouse = await f.createWarehouse();
    for (let i = 0; i < N; i += 1) {
      const product = await f.createProduct({ reorderLevel: 50 });
      await f.createInventory({ productId: product.id, warehouseId: warehouse.id, quantity: i + 1 });
    }
    const healthy = await f.createProduct({ reorderLevel: 5 });
    await f.createInventory({ productId: healthy.id, warehouseId: warehouse.id, quantity: 500 });
  },
  transfers: async () => {
    const from = await f.createWarehouse();
    const to = await f.createWarehouse();
    for (let i = 0; i < N; i += 1) {
      await prisma.stockTransfer.create({
        data: { transferNumber: `TRF-T-${i}`, fromWarehouseId: from.id, toWarehouseId: to.id, status: "COMPLETED" },
      });
    }
  },
  requisitions: async () => {
    for (let i = 0; i < N; i += 1) await f.createRequisition();
  },
  orders: async () => {
    for (let i = 0; i < N; i += 1) await f.createPurchaseOrder();
  },
  receipts: async () => {
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder();
    for (let i = 0; i < N; i += 1) {
      await prisma.goodsReceipt.create({
        data: { receiptNumber: `GR-T-${i}`, purchaseOrderId: po.id, warehouseId: warehouse.id },
      });
    }
  },
  invoices: async () => {
    const supplier = await f.createSupplier();
    for (let i = 0; i < N; i += 1) {
      await prisma.purchaseInvoice.create({
        data: { invoiceNumber: `INV-T-${i}`, supplierId: supplier.id, subtotal: "1.00", totalAmount: "1.00" },
      });
    }
  },
};

const endpoints = [
  ["inventory", "/api/v1/inventory", N],
  ["transactions", "/api/v1/inventory/transactions", N],
  ["lowStock", "/api/v1/inventory/low-stock", N],
  ["transfers", "/api/v1/stock-transfers", N],
  ["requisitions", "/api/v1/procurement/requisitions", N],
  ["orders", "/api/v1/procurement/purchase-orders", N],
  ["receipts", "/api/v1/procurement/goods-receipts", N],
  ["invoices", "/api/v1/procurement/purchase-invoices", N],
];

describe.each(endpoints)("pagination on %s (D-07)", (name, path, total) => {
  beforeEach(seeders[name]);

  it("keeps data an array and adds a pagination object with defaults", async () => {
    const res = await api().get(path);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(total);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total, totalPages: 1 });
  });

  it("pages without gaps or repeats and reports totals", async () => {
    const ids = [];

    for (const page of [1, 2, 3]) {
      const res = await api().get(path).query({ page, pageSize: 2 });

      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual({ page, pageSize: 2, total, totalPages: 3 });
      ids.push(...res.body.data.map((row) => row.id));
    }

    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it("returns an empty page past the end, with the real total", async () => {
    const res = await api().get(path).query({ page: 99, pageSize: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(total);
  });

  it("accepts pageSize 100 and rejects 101, 0, negative and non-numeric values", async () => {
    expect((await api().get(path).query({ pageSize: 100 })).status).toBe(200);

    for (const query of [{ pageSize: 101 }, { pageSize: 0 }, { page: 0 }, { page: -3 }, { page: "abc" }, { pageSize: "x" }]) {
      const res = await api().get(path).query(query);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    }
  });

  it("accepts limit as an alias of pageSize", async () => {
    const res = await api().get(path).query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.pageSize).toBe(2);
  });
});

describe("list endpoint specifics", () => {
  it("low-stock keeps count and only counts matching rows", async () => {
    await seeders.lowStock();

    const res = await api().get("/api/v1/inventory/low-stock").query({ pageSize: 2 });

    expect(res.body.count).toBe(N);
    expect(res.body.pagination.total).toBe(N);
    expect(res.body.data.every((row) => row.availableQuantity <= row.product.reorderLevel)).toBe(true);
  });

  it("transactions still filter by type and validate filters", async () => {
    await seeders.transactions();

    const filtered = await api().get("/api/v1/inventory/transactions").query({ type: "ISSUE" });
    expect(filtered.body.data).toEqual([]);
    expect(filtered.body.pagination.total).toBe(0);

    const bad = await api().get("/api/v1/inventory/transactions").query({ type: "NOPE" });
    expect(bad.status).toBe(400);
  });
});
