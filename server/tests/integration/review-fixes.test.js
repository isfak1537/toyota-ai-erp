
const app = require("../../src/app");
const { authed } = require("../helpers/http");
const procurementService = require("../../src/services/procurement.service");
const stockTransferService = require("../../src/services/stock-transfer.service");
const { ConflictError } = require("../../src/errors/app-error");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { ledgerFor } = require("../helpers/ledger");
const { settle, times } = require("../helpers/concurrency");

const api = () => authed(app);

beforeEach(resetDatabase);
afterAll(disconnect);

describe("status transitions are atomic (idempotent approvals)", () => {
  it("10 parallel submits of one DRAFT requisition: exactly one succeeds", async () => {
    const requisition = await f.createRequisition({ status: "DRAFT" });

    const { ok, failed } = await settle(times(10, () => procurementService.submitRequisition(requisition.id)));

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    failed.forEach((error) => {
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.message).toBe("Only DRAFT requisitions can be submitted");
    });
    expect((await prisma.purchaseRequisition.findUnique({ where: { id: requisition.id } })).status).toBe("SUBMITTED");
  });

  it("10 parallel approvals of one SUBMITTED requisition: exactly one succeeds", async () => {
    const requisition = await f.createRequisition({ status: "SUBMITTED" });

    const { ok, failed } = await settle(times(10, () => procurementService.approveRequisition(requisition.id)));

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    expect(ok[0].status).toBe("APPROVED");
  });

  it("10 parallel approvals of one PENDING_APPROVAL purchase order: exactly one succeeds", async () => {
    const product = await f.createProduct();
    const po = await f.createPurchaseOrder({ status: "PENDING_APPROVAL", items: [{ productId: product.id, quantity: 1 }] });

    const { ok, failed } = await settle(times(10, () => procurementService.approvePurchaseOrder(po.id)));

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    failed.forEach((error) => expect(error).toBeInstanceOf(ConflictError));
  });

  it("missing records are 404 and wrong states 409 through the API", async () => {
    expect((await api().post("/api/v1/procurement/requisitions/999999/approve")).status).toBe(404);
    expect((await api().post("/api/v1/procurement/purchase-orders/999999/approve")).status).toBe(404);

    const requisition = await f.createRequisition({ status: "APPROVED" });
    expect((await api().post(`/api/v1/procurement/requisitions/${requisition.id}/approve`)).status).toBe(409);
  });
});

describe("DELETE /inventory/:id only removes empty records", () => {
  it("refuses to delete a record holding stock and leaves it untouched", async () => {
    const s = await f.stockScenario({ quantity: 5 });

    const res = await api().delete(`/api/v1/inventory/${s.inventory.id}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/still holds stock/);
    expect(await prisma.inventory.count()).toBe(1);
  });

  it("refuses to delete a record with only reserved stock", async () => {
    const s = await f.stockScenario({ quantity: 0, reserved: 0 });
    await prisma.$executeRaw`UPDATE "Inventory" SET "quantity" = 3, "reservedQuantity" = 3 WHERE id = ${s.inventory.id}`;

    expect((await api().delete(`/api/v1/inventory/${s.inventory.id}`)).status).toBe(409);
  });

  it("deletes an empty record, 404s a missing one and 400s a malformed id", async () => {
    const s = await f.stockScenario({ quantity: 0 });

    const ok = await api().delete(`/api/v1/inventory/${s.inventory.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, message: "Inventory deleted successfully" });
    expect(await prisma.inventory.count()).toBe(0);

    expect((await api().delete(`/api/v1/inventory/${s.inventory.id}`)).status).toBe(404);
    expect((await api().delete("/api/v1/inventory/abc")).status).toBe(400);
  });
});

describe("concurrent inventory creation", () => {
  it("10 parallel creates of the same product and warehouse: one 201, nine 409 with the specific message", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();

    const responses = await Promise.all(
      times(10, () => api().post("/api/v1/inventory").send({ productId: product.id, warehouseId: warehouse.id }))
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(conflicts).toHaveLength(9);
    conflicts.forEach((r) =>
      expect(r.body.message).toBe("Inventory record already exists for this product and warehouse")
    );
    expect(await prisma.inventory.count()).toBe(1);
  });
});

describe("failed multi-item operations roll back completely", () => {
  it("a transfer whose second item lacks stock moves nothing", async () => {
    const a = await f.stockScenario({ quantity: 10 });
    const b = await f.createProduct();
    await f.createInventory({ productId: b.id, warehouseId: a.warehouse.id, quantity: 1 });
    const destination = await f.createWarehouse();

    const res = await api()
      .post("/api/v1/stock-transfers")
      .send({
        fromWarehouseId: a.warehouse.id,
        toWarehouseId: destination.id,
        items: [
          { productId: a.product.id, quantity: 5 },
          { productId: b.id, quantity: 99 },
        ],
      });

    expect(res.status).toBe(409);
    expect(await prisma.stockTransfer.count()).toBe(0);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    expect(await prisma.inventory.count({ where: { warehouseId: destination.id } })).toBe(0);
    expect((await prisma.inventory.findUnique({ where: { productId_warehouseId: { productId: a.product.id, warehouseId: a.warehouse.id } } })).quantity).toBe(10);
  });

  it("a goods receipt whose second line is invalid creates no receipt, stock or PO progress", async () => {
    const p1 = await f.createProduct();
    const p2 = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({
      items: [
        { productId: p1.id, quantity: 10 },
        { productId: p2.id, quantity: 2 },
      ],
    });

    const res = await api()
      .post("/api/v1/procurement/goods-receipts")
      .send({
        purchaseOrderId: po.id,
        warehouseId: warehouse.id,
        items: [
          { purchaseOrderItemId: po.items[0].id, productId: p1.id, quantity: 4 },
          { purchaseOrderItemId: po.items[1].id, productId: p2.id, quantity: 3 },
        ],
      });

    expect(res.status).toBe(409);
    expect(await prisma.goodsReceipt.count()).toBe(0);
    expect(await prisma.inventory.count()).toBe(0);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
    expect(items.every((i) => i.receivedQuantity === 0)).toBe(true);
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("APPROVED");
  });
});

describe("strict id parsing at the API", () => {
  it.each(["1e3", "0x10", "%205", "99999999999", "-1", "0"])("GET /inventory/%s is a 400", async (id) => {
    const res = await api().get(`/api/v1/inventory/${id}`);

    expect(res.status).toBe(400);
  });

  it("GET /stock-transfers/abc is a 400 and an unknown id a 404", async () => {
    expect((await api().get("/api/v1/stock-transfers/abc")).status).toBe(400);
    expect((await api().get("/api/v1/stock-transfers/999999")).status).toBe(404);
  });

  it("a duplicate stock transfer item list is rejected before any stock moves", async () => {
    const s = await f.stockScenario({ quantity: 10 });
    const to = await f.createWarehouse();

    await expect(
      stockTransferService.completeTransfer({
        fromWarehouseId: s.warehouse.id,
        toWarehouseId: to.id,
        items: [
          { productId: s.product.id, quantity: 1 },
          { productId: s.product.id, quantity: 1 },
        ],
      })
    ).rejects.toThrow(/appears more than once/);
    expect(await ledgerFor(s.product.id, s.warehouse.id)).toHaveLength(0);
  });
});
