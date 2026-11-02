const request = require("supertest");

const app = require("../../src/app");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile, ledgerFor } = require("../helpers/ledger");

const api = () => request(app);

beforeEach(resetDatabase);
afterAll(disconnect);

const body = (s, w, quantity, extra = {}) => ({
  productId: s.product.id,
  warehouseId: s.warehouse.id,
  quantity,
  ...extra,
});

describe("inventory writes: happy paths and ledger", () => {
  it("creates an inventory record", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();

    const res = await api()
      .post("/api/v1/inventory")
      .send({ productId: product.id, warehouseId: warehouse.id });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ quantity: 0, reservedQuantity: 0 });
  });

  it("receives stock and writes a RECEIPT ledger row with the new balance", async () => {
    const s = await f.stockScenario({ quantity: 10 });

    const res = await api().post("/api/v1/inventory/receive").send(body(s, s.warehouse, 5));

    expect(res.status).toBe(201);
    expect(res.body.data.inventory.quantity).toBe(15);
    expect(res.body.data.transaction).toMatchObject({ type: "RECEIPT", quantity: 5, balanceAfter: 15 });
    await reconcile(s.product.id, s.warehouse.id, 10);
  });

  it("issues stock and writes an ISSUE ledger row", async () => {
    const s = await f.stockScenario({ quantity: 10 });

    const res = await api().post("/api/v1/inventory/issue").send(body(s, s.warehouse, 4));

    expect(res.status).toBe(201);
    expect(res.body.data.inventory.quantity).toBe(6);
    expect(res.body.data.transaction).toMatchObject({ type: "ISSUE", quantity: -4, balanceAfter: 6 });
    await reconcile(s.product.id, s.warehouse.id, 10);
  });

  it("adjusts stock up and down", async () => {
    const s = await f.stockScenario({ quantity: 10 });

    await api().post("/api/v1/inventory/adjust").send(body(s, s.warehouse, 5)).expect(201);
    await api().post("/api/v1/inventory/adjust").send(body(s, s.warehouse, -12)).expect(201);

    const { inventory } = await reconcile(s.product.id, s.warehouse.id, 10);
    expect(inventory.quantity).toBe(3);
  });

  it("reserves then releases stock without moving on-hand quantity", async () => {
    const s = await f.stockScenario({ quantity: 10 });

    const reserved = await api().post("/api/v1/inventory/reserve").send(body(s, s.warehouse, 6));
    expect(reserved.status).toBe(201);
    expect(reserved.body.data.inventory).toMatchObject({ quantity: 10, reservedQuantity: 6 });

    const released = await api().post("/api/v1/inventory/release").send(body(s, s.warehouse, 2));
    expect(released.status).toBe(201);
    expect(released.body.data.inventory).toMatchObject({ quantity: 10, reservedQuantity: 4 });

    const { rows } = await reconcile(s.product.id, s.warehouse.id, 10);
    expect(rows.map((r) => r.type)).toEqual(["RESERVATION", "RELEASE"]);
    expect(rows.every((r) => r.balanceAfter === 10)).toBe(true);
  });

  it("transfers stock between warehouses with both ledger sides", async () => {
    const source = await f.stockScenario({ quantity: 20 });
    const destination = await f.createWarehouse();

    const res = await api()
      .post("/api/v1/stock-transfers")
      .send({
        fromWarehouseId: source.warehouse.id,
        toWarehouseId: destination.id,
        items: [{ productId: source.product.id, quantity: 7 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("COMPLETED");
    await reconcile(source.product.id, source.warehouse.id, 20);

    const out = await ledgerFor(source.product.id, source.warehouse.id);
    const inn = await ledgerFor(source.product.id, destination.id);
    expect(out[0]).toMatchObject({ type: "TRANSFER_OUT", quantity: -7, balanceAfter: 13 });
    expect(inn[0]).toMatchObject({ type: "TRANSFER_IN", quantity: 7, balanceAfter: 7 });
  });
});

describe("inventory writes: 409 mappings", () => {
  it("rejects a duplicate inventory record", async () => {
    const s = await f.stockScenario({ quantity: 1 });

    const res = await api()
      .post("/api/v1/inventory")
      .send({ productId: s.product.id, warehouseId: s.warehouse.id });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/);
  });

  it("rejects stock operations on an inactive product", async () => {
    const s = await f.stockScenario({ quantity: 10, product: { isActive: false } });

    const res = await api().post("/api/v1/inventory/issue").send(body(s, s.warehouse, 1));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Product is inactive");
  });

  it("rejects stock operations when stock tracking is disabled", async () => {
    const s = await f.stockScenario({ quantity: 10, product: { isStockTracked: false } });

    const res = await api().post("/api/v1/inventory/receive").send(body(s, s.warehouse, 1));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Stock tracking is disabled/);
  });

  it("rejects stock operations on an inactive warehouse", async () => {
    const s = await f.stockScenario({ quantity: 10, warehouse: { isActive: false } });

    const res = await api().post("/api/v1/inventory/issue").send(body(s, s.warehouse, 1));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Warehouse is inactive");
  });

  it("rejects issuing more than the available stock and changes nothing", async () => {
    const s = await f.stockScenario({ quantity: 10, reserved: 4 });

    const res = await api().post("/api/v1/inventory/issue").send(body(s, s.warehouse, 7));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Insufficient available stock. Available: 6, requested: 7");
    expect(await ledgerFor(s.product.id, s.warehouse.id)).toHaveLength(0);
    const inv = await prisma.inventory.findUnique({ where: { id: s.inventory.id } });
    expect(inv).toMatchObject({ quantity: 10, reservedQuantity: 4 });
  });

  it("rejects an adjustment that would make stock negative", async () => {
    const s = await f.stockScenario({ quantity: 5 });

    const res = await api().post("/api/v1/inventory/adjust").send(body(s, s.warehouse, -6));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Adjustment would result in negative stock");
  });

  it("rejects an adjustment that would drop stock below the reserved quantity", async () => {
    const s = await f.stockScenario({ quantity: 10, reserved: 8 });

    const res = await api().post("/api/v1/inventory/adjust").send(body(s, s.warehouse, -3));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Adjustment would make stock lower than reserved quantity (8)");
  });

  it("rejects reserving more than the available stock", async () => {
    const s = await f.stockScenario({ quantity: 10, reserved: 6 });

    const res = await api().post("/api/v1/inventory/reserve").send(body(s, s.warehouse, 5));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Insufficient available stock for reservation. Available: 4, requested: 5");
  });

  it("rejects releasing more than the reserved quantity", async () => {
    const s = await f.stockScenario({ quantity: 10, reserved: 3 });

    const res = await api().post("/api/v1/inventory/release").send(body(s, s.warehouse, 4));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Cannot release 4. Reserved quantity: 3");
  });
});

describe("stock transfer: 409 mappings", () => {
  it("rejects a transfer when a warehouse is inactive", async () => {
    const source = await f.stockScenario({ quantity: 10, warehouse: { isActive: false } });
    const destination = await f.createWarehouse();

    const res = await api()
      .post("/api/v1/stock-transfers")
      .send({
        fromWarehouseId: source.warehouse.id,
        toWarehouseId: destination.id,
        items: [{ productId: source.product.id, quantity: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Both warehouses must be active");
  });

  it("rejects a transfer of an inactive product", async () => {
    const source = await f.stockScenario({ quantity: 10, product: { isActive: false } });
    const destination = await f.createWarehouse();

    const res = await api()
      .post("/api/v1/stock-transfers")
      .send({
        fromWarehouseId: source.warehouse.id,
        toWarehouseId: destination.id,
        items: [{ productId: source.product.id, quantity: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/inactive or stock tracking is disabled/);
  });

  it("rejects a transfer with insufficient stock and leaves everything untouched", async () => {
    const source = await f.stockScenario({ quantity: 5 });
    const destination = await f.createWarehouse();

    const res = await api()
      .post("/api/v1/stock-transfers")
      .send({
        fromWarehouseId: source.warehouse.id,
        toWarehouseId: destination.id,
        items: [{ productId: source.product.id, quantity: 6 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Insufficient stock/);
    expect(await prisma.stockTransfer.count()).toBe(0);
    expect(await prisma.inventory.count()).toBe(1);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });
});
