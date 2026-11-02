// AUTH-002 / NFR-004: stock-changing and approval actions record who did them.
const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

const as = async (role) => {
  const { user, token } = await createUser(role);

  return { user, api: authed(app, token) };
};

const stockBody = (s, quantity) => ({ productId: s.product.id, warehouseId: s.warehouse.id, quantity });

describe("inventory movements", () => {
  it("record the acting user on every ledger row", async () => {
    const manager = await as("WAREHOUSE_MANAGER");
    const s = await f.stockScenario({ quantity: 20 });

    await manager.api.post("/api/v1/inventory/receive").send(stockBody(s, 5)).expect(201);
    await manager.api.post("/api/v1/inventory/issue").send(stockBody(s, 2)).expect(201);
    await manager.api.post("/api/v1/inventory/adjust").send(stockBody(s, -1)).expect(201);
    await manager.api.post("/api/v1/inventory/reserve").send(stockBody(s, 3)).expect(201);
    await manager.api.post("/api/v1/inventory/release").send(stockBody(s, 1)).expect(201);

    const rows = await prisma.inventoryTransaction.findMany({ orderBy: { id: "asc" } });

    expect(rows.map((r) => r.type)).toEqual(["RECEIPT", "ISSUE", "ADJUSTMENT", "RESERVATION", "RELEASE"]);
    expect(rows.every((r) => r.createdById === manager.user.id)).toBe(true);
  });

  it("record the user on both sides of a stock transfer", async () => {
    const manager = await as("WAREHOUSE_MANAGER");
    const source = await f.stockScenario({ quantity: 10 });
    const destination = await f.createWarehouse();

    await manager.api
      .post("/api/v1/stock-transfers")
      .send({ fromWarehouseId: source.warehouse.id, toWarehouseId: destination.id, items: [{ productId: source.product.id, quantity: 4 }] })
      .expect(201);

    const rows = await prisma.inventoryTransaction.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => r.type).sort()).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
    expect(rows.every((r) => r.createdById === manager.user.id)).toBe(true);
  });

  it("cannot be attributed to someone else through the request body", async () => {
    const manager = await as("WAREHOUSE_MANAGER");
    const other = await createUser("ADMIN");
    const s = await f.stockScenario({ quantity: 5 });

    const res = await manager.api.post("/api/v1/inventory/receive").send({ ...stockBody(s, 1), actorId: other.user.id, createdById: other.user.id });

    expect(res.status).toBe(400);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });
});

describe("procurement", () => {
  it("records who created and approved a requisition, approved a PO and received the goods", async () => {
    const officer = await as("PROCUREMENT_OFFICER");
    const approver = await as("ADMIN");
    const storeman = await as("WAREHOUSE_MANAGER");
    const product = await f.createProduct();
    const supplier = await f.createSupplier();
    const warehouse = await f.createWarehouse();

    const pr = await officer.api
      .post("/api/v1/procurement/requisitions")
      .send({ requesterName: "Officer", supplierId: supplier.id, items: [{ productId: product.id, quantity: 4, estimatedUnitPrice: 2 }] })
      .expect(201);
    const prId = pr.body.data.id;
    await officer.api.post(`/api/v1/procurement/requisitions/${prId}/submit`).expect(200);
    await approver.api.post(`/api/v1/procurement/requisitions/${prId}/approve`).expect(200);

    const po = (await officer.api
      .post("/api/v1/procurement/purchase-orders")
      .send({ supplierId: supplier.id, requisitionId: prId, items: [{ productId: product.id, quantity: 4, unitPrice: 2 }] })
      .expect(201)).body.data;
    await approver.api.post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).expect(200);

    const gr = await storeman.api
      .post("/api/v1/procurement/goods-receipts")
      .send({ purchaseOrderId: po.id, warehouseId: warehouse.id, items: [{ purchaseOrderItemId: po.items[0].id, productId: product.id, quantity: 4 }] })
      .expect(201);

    const requisition = await prisma.purchaseRequisition.findUnique({ where: { id: prId } });
    expect(requisition).toMatchObject({ createdById: officer.user.id, approvedById: approver.user.id });
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).approvedById).toBe(approver.user.id);
    expect((await prisma.goodsReceipt.findUnique({ where: { id: gr.body.data.id } })).createdById).toBe(storeman.user.id);

    const ledger = await prisma.inventoryTransaction.findFirst({ where: { referenceType: "GOODS_RECEIPT", referenceId: gr.body.data.id } });
    expect(ledger.createdById).toBe(storeman.user.id);
  });
});
