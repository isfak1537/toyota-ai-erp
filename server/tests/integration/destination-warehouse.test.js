// destinationWarehouseId on requisition and purchase order headers, and the goods receipt rules around it.
const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { buildDataset } = require("../../prisma/seed/build");
const { writeDataset } = require("../../prisma/seed/writer");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const api = () => authed(app);

beforeEach(resetDatabase);
afterAll(disconnect);

const base = async () => ({
  product: await f.createProduct(),
  supplier: await f.createSupplier(),
  home: await f.createWarehouse(),
  other: await f.createWarehouse(),
});

const makeRequisition = async (ctx, extra = {}) => {
  const res = await api()
    .post("/api/v1/procurement/requisitions")
    .send({
      requesterName: "T",
      supplierId: ctx.supplier.id,
      items: [{ productId: ctx.product.id, quantity: 10, estimatedUnitPrice: 2 }],
      ...extra,
    });
  const id = res.body.data?.id;

  if (res.status === 201) {
    await api().post(`/api/v1/procurement/requisitions/${id}/submit`).expect(200);
    await api().post(`/api/v1/procurement/requisitions/${id}/approve`).expect(200);
  }

  return res;
};

const makePo = (ctx, extra = {}) =>
  api()
    .post("/api/v1/procurement/purchase-orders")
    .send({ supplierId: ctx.supplier.id, items: [{ productId: ctx.product.id, quantity: 10, unitPrice: 2 }], ...extra });

const approvedPo = async (ctx, destinationWarehouseId) => {
  const po = (await makePo(ctx, destinationWarehouseId ? { destinationWarehouseId } : {}).expect(201)).body.data;
  await api().post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).expect(200);

  return po;
};

const receipt = (po, ctx, body = {}, token) => {
  const client = token ? authed(app, token) : api();

  return client.post("/api/v1/procurement/goods-receipts").send({
    purchaseOrderId: po.id,
    items: [{ purchaseOrderItemId: po.items[0].id, productId: ctx.product.id, quantity: 4 }],
    ...body,
  });
};

describe("requisition and purchase order headers", () => {
  it("keep working without a destination (nullable, optional)", async () => {
    const ctx = await base();
    const pr = await makeRequisition(ctx);
    const po = await makePo(ctx, { requisitionId: pr.body.data.id });

    expect(pr.status).toBe(201);
    expect(pr.body.data.destinationWarehouseId).toBeNull();
    expect(po.status).toBe(201);
    expect(po.body.data.destinationWarehouseId).toBeNull();
  });

  it("store a destination on a requisition and reject an unknown or inactive warehouse with 404", async () => {
    const ctx = await base();
    const inactive = await f.createWarehouse({ isActive: false });

    expect((await makeRequisition(ctx, { destinationWarehouseId: ctx.home.id })).body.data.destinationWarehouseId).toBe(ctx.home.id);
    expect((await makeRequisition(ctx, { destinationWarehouseId: 999999 })).status).toBe(404);
    expect((await makeRequisition(ctx, { destinationWarehouseId: inactive.id })).status).toBe(404);
    expect((await makeRequisition(ctx, { destinationWarehouseId: "abc" })).status).toBe(400);
  });

  it("a purchase order inherits the requisition's destination", async () => {
    const ctx = await base();
    const pr = await makeRequisition(ctx, { destinationWarehouseId: ctx.home.id });

    const inherited = await makePo(ctx, { requisitionId: pr.body.data.id, items: [{ productId: ctx.product.id, quantity: 5, unitPrice: 2 }] });
    expect(inherited.status).toBe(201);
    expect(inherited.body.data.destinationWarehouseId).toBe(ctx.home.id);

    const same = await makePo(ctx, { requisitionId: pr.body.data.id, destinationWarehouseId: ctx.home.id, items: [{ productId: ctx.product.id, quantity: 5, unitPrice: 2 }] });
    expect(same.status).toBe(201);
  });

  it("a purchase order that names a different destination than its requisition is a 400", async () => {
    const ctx = await base();
    const pr = await makeRequisition(ctx, { destinationWarehouseId: ctx.home.id });

    const res = await makePo(ctx, { requisitionId: pr.body.data.id, destinationWarehouseId: ctx.other.id });

    expect(res.status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it("a purchase order may set its own destination when the requisition has none, or when there is no requisition", async () => {
    const ctx = await base();
    const pr = await makeRequisition(ctx);

    expect((await makePo(ctx, { requisitionId: pr.body.data.id, destinationWarehouseId: ctx.other.id })).body.data.destinationWarehouseId).toBe(ctx.other.id);
    expect((await makePo(ctx, { destinationWarehouseId: ctx.home.id })).body.data.destinationWarehouseId).toBe(ctx.home.id);
  });
});

describe("goods receipt warehouse", () => {
  it("defaults to the purchase order's destination when warehouseId is omitted", async () => {
    const ctx = await base();
    const po = await approvedPo(ctx, ctx.home.id);

    const res = await receipt(po, ctx);

    expect(res.status).toBe(201);
    expect(res.body.data.warehouseId).toBe(ctx.home.id);
    expect((await prisma.inventory.findFirst({ where: { warehouseId: ctx.home.id } })).quantity).toBe(4);
  });

  it("without a destination, warehouseId is still required (400) and still works as before", async () => {
    const ctx = await base();
    const po = await approvedPo(ctx);

    expect((await receipt(po, ctx)).status).toBe(400);
    expect((await receipt(po, ctx, { warehouseId: ctx.other.id })).status).toBe(201);
  });

  it("accepts the destination when given explicitly, and rejects another warehouse with 400", async () => {
    const ctx = await base();
    const po = await approvedPo(ctx, ctx.home.id);

    expect((await receipt(po, ctx, { warehouseId: ctx.home.id })).status).toBe(201);

    const wrong = await receipt(po, ctx, { warehouseId: ctx.other.id });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/allowDifferentWarehouse/);
    expect(await prisma.goodsReceipt.count()).toBe(1);
    expect(await prisma.aiAuditLog.count()).toBe(0);
  });

  it("lets a WAREHOUSE_MANAGER or ADMIN receive elsewhere on purpose, and audits it", async () => {
    const ctx = await base();
    const manager = await createUser("WAREHOUSE_MANAGER");
    const po = await approvedPo(ctx, ctx.home.id);

    const res = await receipt(po, ctx, { warehouseId: ctx.other.id, allowDifferentWarehouse: true }, manager.token);

    expect(res.status).toBe(201);
    expect(res.body.data.warehouseId).toBe(ctx.other.id);

    const audit = await prisma.aiAuditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      eventType: "GOODS_RECEIPT_WAREHOUSE_OVERRIDE",
      actorUserId: manager.user.id,
      payload: { purchaseOrderId: po.id, destinationWarehouseId: ctx.home.id, receivedIntoWarehouseId: ctx.other.id },
    });
  });

  it("refuses the override for a PROCUREMENT_OFFICER with 403 and writes nothing", async () => {
    const ctx = await base();
    const officer = await createUser("PROCUREMENT_OFFICER");
    const po = await approvedPo(ctx, ctx.home.id);

    const res = await receipt(po, ctx, { warehouseId: ctx.other.id, allowDifferentWarehouse: true }, officer.token);

    expect(res.status).toBe(403);
    expect(await prisma.goodsReceipt.count()).toBe(0);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    expect(await prisma.aiAuditLog.count()).toBe(0);
  });

  it("does not audit allowDifferentWarehouse when the warehouse is the destination anyway; rejects a non-boolean flag", async () => {
    const ctx = await base();
    const po = await approvedPo(ctx, ctx.home.id);

    expect((await receipt(po, ctx, { warehouseId: ctx.home.id, allowDifferentWarehouse: true })).status).toBe(201);
    expect(await prisma.aiAuditLog.count()).toBe(0);
    expect((await receipt(po, ctx, { allowDifferentWarehouse: "yes" })).status).toBe(400);
  });
});

describe("seed", () => {
  it("gives every purchase order the warehouse its goods go to, in flight or received", async () => {
    const dataset = buildDataset();
    await writeDataset(prisma, dataset);

    const orders = await prisma.purchaseOrder.findMany({ include: { goodsReceipts: true, destinationWarehouse: true } });
    const byNumber = new Map(dataset.purchaseOrders.map((po) => [po.number, po]));

    expect(orders.length).toBe(dataset.purchaseOrders.length);
    expect(orders.every((po) => po.destinationWarehouseId !== null)).toBe(true);
    expect(orders.every((po) => po.destinationWarehouse.code === byNumber.get(po.poNumber).receivingWarehouseCode)).toBe(true);
    expect(orders.filter((po) => po.status === "APPROVED").length).toBeGreaterThan(0); // in-flight ones included
    expect(orders.flatMap((po) => po.goodsReceipts.map((g) => [g.warehouseId, po.destinationWarehouseId])).every(([a, b]) => a === b)).toBe(true);
  });
});
