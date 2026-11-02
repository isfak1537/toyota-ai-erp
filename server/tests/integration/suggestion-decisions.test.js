// AI-007 (atomic, idempotent approval), AI-011 (audit), AUTH-002 (who decided).
const request = require("supertest");

const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { settle, times } = require("../helpers/concurrency");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

afterAll(disconnect);
beforeEach(resetDatabase);

const api = () => authed(app);

// A PENDING suggestion written straight to the database (the run itself is covered elsewhere).
const suggestion = async (overrides = {}) => {
  const s = await f.stockScenario({ quantity: 10 });
  const supplier = await f.createSupplier();
  await prisma.supplierProduct.create({ data: { supplierId: supplier.id, productId: s.product.id, unitPrice: "7.25", leadTimeDays: 4, minimumOrderQty: 10 } });

  const row = await prisma.aiSuggestion.create({
    data: {
      runId: "run-test",
      productId: s.product.id,
      warehouseId: s.warehouse.id,
      supplierId: supplier.id,
      suggestedQty: 42,
      forecastDaily: 10,
      sigma: 3,
      leadTimeDays: 4,
      minimumOrderQty: 10,
      safetyStock: 9.9,
      reorderPoint: 49.9,
      available: 10,
      onOrder: 0,
      onOrderMethod: "NONE",
      inputs: {},
      zValue: 1.65,
      reviewDays: 7,
      forecastModel: "ML",
      modelVersion: "forecast-test-0001",
      ...overrides,
    },
  });

  return { ...s, supplier, row };
};

const approve = (id, token) => (token ? authed(app, token) : api()).post(`/api/v1/ai/suggestions/${id}/approve`).send({});
const reject = (id, body = { reason: "Not needed this month" }, token) => (token ? authed(app, token) : api()).post(`/api/v1/ai/suggestions/${id}/reject`).send(body);

describe("approve", () => {
  it("creates one DRAFT requisition from the suggestion, links it and records the approver", async () => {
    const s = await suggestion();
    const officer = await createUser("PROCUREMENT_OFFICER", { name: "Olivia Officer" });

    const res = await approve(s.row.id, officer.token);

    expect(res.status).toBe(201);
    expect(res.body.data.idempotent).toBe(false);

    const requisition = await prisma.purchaseRequisition.findFirst({ include: { items: true } });
    expect(requisition).toMatchObject({
      status: "DRAFT",
      requesterName: "Olivia Officer",
      supplierId: s.supplier.id,
      destinationWarehouseId: s.warehouse.id,
      createdById: officer.user.id,
      approvedById: null,
      sourceType: "AI_SUGGESTION",
      sourceId: s.row.id,
    });
    expect(requisition.items).toHaveLength(1);
    expect(requisition.items[0]).toMatchObject({ productId: s.product.id, quantity: 42 });
    expect(requisition.items[0].estimatedUnitPrice.toString()).toBe("7.25");

    const after = await prisma.aiSuggestion.findUnique({ where: { id: s.row.id } });
    expect(after).toMatchObject({ status: "APPROVED", decidedById: officer.user.id, requisitionId: requisition.id });
    expect(after.decidedAt).toBeInstanceOf(Date);
  });

  it("audits the decision", async () => {
    const s = await suggestion();
    const officer = await createUser("PROCUREMENT_OFFICER");

    await approve(s.row.id, officer.token).expect(201);
    const audit = await prisma.aiAuditLog.findMany({ where: { eventType: "SUGGESTION_APPROVED" } });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: officer.user.id, payload: { suggestionId: s.row.id, quantity: 42, supplierId: s.supplier.id, modelVersion: "forecast-test-0001" } });
  });

  it("approving twice returns the same requisition and creates no second one", async () => {
    const s = await suggestion();

    const first = await approve(s.row.id).expect(201);
    const second = await approve(s.row.id).expect(200);

    expect(second.body.data.idempotent).toBe(true);
    expect(second.body.data.requisition.id).toBe(first.body.data.requisition.id);
    expect(await prisma.purchaseRequisition.count()).toBe(1);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "SUGGESTION_APPROVED" } })).toBe(1);
  });

  it("PARALLEL double approve: exactly one requisition, every caller sees the same one", async () => {
    const s = await suggestion();
    const users = await Promise.all(times(3, () => createUser("PROCUREMENT_OFFICER")));

    const { ok, failed } = await settle(times(12, (i) => approve(s.row.id, users[i % 3].token).then((r) => r)));

    expect(failed).toEqual([]);
    expect(ok.map((r) => r.status).sort((a, b) => a - b)).toEqual([...Array(11).fill(200), 201]);
    expect(new Set(ok.map((r) => r.body.data.requisition.id)).size).toBe(1);
    expect(await prisma.purchaseRequisition.count()).toBe(1);
    expect(await prisma.purchaseRequisitionItem.count()).toBe(1);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "SUGGESTION_APPROVED" } })).toBe(1);
    expect((await prisma.aiSuggestion.findUnique({ where: { id: s.row.id } })).requisitionId).toBe(ok[0].body.data.requisition.id);
  });

  it("PARALLEL approve and reject: one decision wins, the other gets 409, and no requisition leaks from a lost approve", async () => {
    for (let round = 0; round < 5; round += 1) {
      const s = await suggestion();
      const [a, r] = await Promise.all([approve(s.row.id), reject(s.row.id)]);
      const after = await prisma.aiSuggestion.findUnique({ where: { id: s.row.id } });

      if (after.status === "APPROVED") {
        expect([a.status, r.status]).toEqual([201, 409]);
        expect(after.requisitionId).not.toBeNull();
      } else {
        expect([a.status, r.status]).toEqual([409, 200]);
        expect(after.requisitionId).toBeNull();
        expect(await prisma.purchaseRequisition.count({ where: { sourceId: s.row.id } })).toBe(0);
      }
    }
  });

  it("409 for REJECTED and EXPIRED suggestions, and nothing is created", async () => {
    const rejected = await suggestion({ status: "REJECTED" });
    const expired = await suggestion({ status: "EXPIRED" });

    expect((await approve(rejected.row.id)).status).toBe(409);
    expect((await approve(expired.row.id)).status).toBe(409);
    expect(await prisma.purchaseRequisition.count()).toBe(0);
  });

  it("409 and nothing created when the supplier, product or warehouse went inactive", async () => {
    const a = await suggestion();
    const b = await suggestion();
    const c = await suggestion();

    await prisma.supplier.update({ where: { id: a.supplier.id }, data: { isActive: false } });
    await prisma.product.update({ where: { id: b.product.id }, data: { isActive: false } });
    await prisma.warehouse.update({ where: { id: c.warehouse.id }, data: { isActive: false } });

    for (const s of [a, b, c]) {
      expect((await approve(s.row.id)).status).toBe(409);
      expect((await prisma.aiSuggestion.findUnique({ where: { id: s.row.id } })).status).toBe("PENDING");
    }

    expect(await prisma.purchaseRequisition.count()).toBe(0);
  });

  it("404 for an unknown id and 400 for a malformed one or a non-empty body", async () => {
    expect((await approve(999999)).status).toBe(404);
    expect((await api().post("/api/v1/ai/suggestions/abc/approve").send({})).status).toBe(400);
    expect((await api().post("/api/v1/ai/suggestions/1e3/approve").send({})).status).toBe(400);

    const s = await suggestion();
    expect((await api().post(`/api/v1/ai/suggestions/${s.row.id}/approve`).send({ suggestedQty: 9999 })).status).toBe(400);
    expect(await prisma.purchaseRequisition.count()).toBe(0);
  });

  it("only PROCUREMENT_OFFICER and ADMIN may approve; no token is 401", async () => {
    const s = await suggestion();

    for (const role of ["VIEWER", "WAREHOUSE_MANAGER"]) {
      expect((await approve(s.row.id, (await createUser(role)).token)).status).toBe(403);
    }

    expect((await request(app).post(`/api/v1/ai/suggestions/${s.row.id}/approve`).send({})).status).toBe(401);
    expect(await prisma.purchaseRequisition.count()).toBe(0);
    expect((await approve(s.row.id, (await createUser("PROCUREMENT_OFFICER")).token)).status).toBe(201);
  });

  it("the requisition continues through the normal flow: a PO inherits the warehouse and a receipt defaults to it", async () => {
    const s = await suggestion();
    const created = (await approve(s.row.id).expect(201)).body.data.requisition;

    await api().post(`/api/v1/procurement/requisitions/${created.id}/submit`).expect(200);
    await api().post(`/api/v1/procurement/requisitions/${created.id}/approve`).expect(200);
    const po = (await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({ supplierId: s.supplier.id, requisitionId: created.id, items: [{ productId: s.product.id, quantity: 42, unitPrice: 7.25 }] })
      .expect(201)).body.data;
    await api().post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).expect(200);
    const gr = await api()
      .post("/api/v1/procurement/goods-receipts")
      .send({ purchaseOrderId: po.id, items: [{ purchaseOrderItemId: po.items[0].id, productId: s.product.id, quantity: 42 }] })
      .expect(201);

    expect(po.destinationWarehouseId).toBe(s.warehouse.id);
    expect(gr.body.data.warehouseId).toBe(s.warehouse.id);
  });
});

describe("reject", () => {
  it("stores the reason and the decider, and audits it", async () => {
    const s = await suggestion();
    const officer = await createUser("PROCUREMENT_OFFICER");

    const res = await reject(s.row.id, { reason: "  Seasonal dip, skip this cycle " }, officer.token);

    expect(res.status).toBe(200);
    expect(await prisma.aiSuggestion.findUnique({ where: { id: s.row.id } })).toMatchObject({ status: "REJECTED", rejectReason: "Seasonal dip, skip this cycle", decidedById: officer.user.id });
    expect(await prisma.aiAuditLog.findMany({ where: { eventType: "SUGGESTION_REJECTED" } })).toEqual([expect.objectContaining({ actorUserId: officer.user.id, payload: { suggestionId: s.row.id, reason: "Seasonal dip, skip this cycle" } })]);
    expect(await prisma.purchaseRequisition.count()).toBe(0);
  });

  it("is idempotent for a repeat, 409 after approval, and needs a reason", async () => {
    const s = await suggestion();
    const t = await suggestion();

    expect((await reject(s.row.id)).status).toBe(200);
    const again = await reject(s.row.id);
    expect(again.status).toBe(200);
    expect(again.body.data.idempotent).toBe(true);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "SUGGESTION_REJECTED" } })).toBe(1);

    await approve(t.row.id).expect(201);
    expect((await reject(t.row.id)).status).toBe(409);

    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "x".repeat(501) }, { reason: 5 }, { reason: "ok", extra: 1 }]) {
      expect((await reject((await suggestion()).row.id, body)).status).toBe(400);
    }
  });

  it("only PROCUREMENT_OFFICER and ADMIN may reject", async () => {
    const s = await suggestion();

    expect((await reject(s.row.id, undefined, (await createUser("VIEWER")).token)).status).toBe(403);
    expect((await reject(s.row.id, undefined, (await createUser("WAREHOUSE_MANAGER")).token)).status).toBe(403);
    expect((await prisma.aiSuggestion.findUnique({ where: { id: s.row.id } })).status).toBe("PENDING");
  });
});

describe("database guarantees behind the service", () => {
  it("refuses a second PENDING suggestion for the same product and warehouse", async () => {
    const s = await suggestion();

    await expect(
      prisma.aiSuggestion.create({ data: { ...s.row, id: undefined, createdAt: undefined, requisitionId: null } })
    ).rejects.toThrow();
  });

  it("refuses APPROVED without a requisition", async () => {
    const s = await suggestion();

    await expect(prisma.aiSuggestion.update({ where: { id: s.row.id }, data: { status: "APPROVED" } })).rejects.toThrow();
  });
});
