const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { startFakeAiService } = require("../helpers/fake-ai-service");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

let fake;

beforeAll(async () => {
  fake = await startFakeAiService();
});
afterAll(async () => {
  await fake.stop();
  await disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  fake.reset();
});

const api = () => authed(app);
const run = (token) => (token ? authed(app, token) : api()).post("/api/v1/ai/replenishment/run").send({});

// product + supplier link + stock, forecast d=10, sigma=3, lead time 4, MOQ 50, available 40 -> 80 units
const scenario = async ({ quantity = 40, reserved = 0, daily = 10, sigma = 3, supplier = {}, link = {}, product = {} } = {}) => {
  const s = await f.stockScenario({ quantity, reserved, product });
  const sup = await f.createSupplier(supplier);
  const sp = await prisma.supplierProduct.create({
    data: { supplierId: sup.id, productId: s.product.id, unitPrice: "5.00", leadTimeDays: 4, minimumOrderQty: 50, isPreferred: true, ...link },
  });

  if (daily !== null) fake.setForecast(s.product.id, s.warehouse.id, { dailyMean: daily, sigma });

  return { ...s, supplier: sup, supplierProduct: sp };
};

describe("POST /ai/replenishment/run", () => {
  it("creates a PENDING suggestion with the computed numbers and every input stored", async () => {
    const s = await scenario();

    const res = await run();

    expect(res.status).toBe(201);
    expect(res.body.data.params).toEqual({ z: 1.65, reviewDays: 7 });
    expect(res.body.data.counts).toMatchObject({ evaluated: 1, suggested: 1, skipped: 0 });

    const row = await prisma.aiSuggestion.findFirst();
    expect(row).toMatchObject({
      productId: s.product.id,
      warehouseId: s.warehouse.id,
      supplierId: s.supplier.id,
      status: "PENDING",
      suggestedQty: 80,
      forecastDaily: 10,
      sigma: 3,
      leadTimeDays: 4,
      minimumOrderQty: 50,
      available: 40,
      onOrder: 0,
      onOrderMethod: "NONE",
      zValue: 1.65,
      reviewDays: 7,
      forecastModel: "ML",
      modelVersion: "forecast-test-0001",
      explanation: null,
      requisitionId: null,
    });
    expect(row.safetyStock).toBeCloseTo(9.9, 8);
    expect(row.reorderPoint).toBeCloseTo(49.9, 8);
    expect(row.inputs).toMatchObject({ quantity: 40, reserved: 0, rawQty: 80, supplier: { selection: "PREFERRED", unitPrice: "5" } });
    expect(await prisma.purchaseRequisition.count()).toBe(0); // AI never writes business records
  });

  it("uses available stock (on hand minus reserved) and skips products that are fine", async () => {
    await scenario({ quantity: 100, reserved: 0 }); // 100 > ROP 49.9
    const low = await scenario({ quantity: 100, reserved: 60 }); // available 40

    const res = await run();

    expect(res.body.data.counts).toMatchObject({ evaluated: 2, suggested: 1, notNeeded: 1 });
    expect((await prisma.aiSuggestion.findMany()).map((r) => r.productId)).toEqual([low.product.id]);
  });

  it("writes an audit entry for the run with parameters, counts and the acting user", async () => {
    await scenario();
    const officer = await createUser("PROCUREMENT_OFFICER");

    const res = await run(officer.token);
    const audit = await prisma.aiAuditLog.findMany({ where: { eventType: "REPLENISHMENT_RUN" } });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: officer.user.id });
    expect(audit[0].payload).toMatchObject({ runId: res.body.data.runId, params: { z: 1.65, reviewDays: 7 }, counts: { suggested: 1, expiredPending: 0 } });
  });

  it("expires older PENDING suggestions on a new run (AI-006) and keeps exactly one per product and warehouse", async () => {
    await scenario();

    await run().expect(201);
    const second = await run();

    const rows = await prisma.aiSuggestion.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["EXPIRED", "PENDING"]);
    expect(second.body.data.counts.expiredPending).toBe(1);
  });

  it("expires a stale suggestion when the product no longer needs replenishing", async () => {
    const s = await scenario();
    await run().expect(201);

    await prisma.inventory.update({ where: { id: s.inventory.id }, data: { quantity: 500 } });
    const res = await run();

    expect(res.body.data.suggestions).toHaveLength(0);
    expect((await prisma.aiSuggestion.findFirst()).status).toBe("EXPIRED");
  });

  it("two runs at once leave exactly one PENDING suggestion per series", async () => {
    await scenario();
    await scenario();

    const results = await Promise.all([run(), run(), run()]);

    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await prisma.aiSuggestion.count({ where: { status: "PENDING" } })).toBe(2);
    expect(await prisma.aiSuggestion.count()).toBe(6);
  });

  it("reports why a series was skipped: no history, no supplier, no lead time", async () => {
    const noHistory = await scenario({ daily: null });
    const noSupplier = await f.stockScenario({ quantity: 1 });
    fake.setForecast(noSupplier.product.id, noSupplier.warehouse.id, { dailyMean: 5, sigma: 1 });
    const noLead = await scenario({ link: { leadTimeDays: null } });

    const res = await run();
    const reasons = Object.fromEntries(res.body.data.skipped.map((x) => [x.productId, x.reason]));

    expect(reasons).toEqual({ [noHistory.product.id]: "NO_HISTORY", [noSupplier.product.id]: "NO_SUPPLIER", [noLead.product.id]: "NO_LEAD_TIME" });
    expect(res.body.data.counts).toMatchObject({ evaluated: 3, suggested: 0, skipped: 3 });
  });

  it("ignores inactive products and warehouses", async () => {
    await scenario({ product: { isActive: false } });
    await scenario({ product: { isStockTracked: false } });
    const inactiveWh = await f.stockScenario({ quantity: 1, warehouse: { isActive: false } });
    fake.setForecast(inactiveWh.product.id, inactiveWh.warehouse.id, { dailyMean: 10, sigma: 1 });

    const res = await run();

    expect(res.body.data.counts.evaluated).toBe(0);
  });

  it("picks the preferred supplier, else the cheapest, and takes lead time and MOQ from that link", async () => {
    const s = await scenario({ quantity: 10, link: { isPreferred: false, unitPrice: "9.00", leadTimeDays: 4, minimumOrderQty: 50 } });
    const cheaper = await f.createSupplier();
    await prisma.supplierProduct.create({ data: { supplierId: cheaper.id, productId: s.product.id, unitPrice: "4.00", leadTimeDays: 2, minimumOrderQty: 120, isPreferred: false } });

    await run().expect(201);
    const row = await prisma.aiSuggestion.findFirst();

    expect(row).toMatchObject({ supplierId: cheaper.id, leadTimeDays: 2, minimumOrderQty: 120 });
    expect(row.suggestedQty).toBe(120); // raw ceil(10*9 + 1.65*3*sqrt(2) - 10) = 87 -> MOQ 120
    expect(row.inputs.supplier.selection).toBe("LOWEST_PRICE");
  });
});

describe("onOrder (destination first, demand share for the rest)", () => {
  const openPo = async (s, { quantity, receivedQuantity = 0, status = "APPROVED", destinationWarehouseId = null }) =>
    f.createPurchaseOrder({ status, supplierId: s.supplier.id, destinationWarehouseId, items: [{ productId: s.product.id, quantity, receivedQuantity }] });

  it("subtracts open PO quantity addressed to this warehouse and records the method", async () => {
    const s = await scenario();
    await openPo(s, { quantity: 30, receivedQuantity: 5, destinationWarehouseId: s.warehouse.id }); // 25 outstanding
    await openPo(s, { quantity: 99, status: "RECEIVED", destinationWarehouseId: s.warehouse.id }); // closed
    await openPo(s, { quantity: 99, status: "CANCELLED", destinationWarehouseId: s.warehouse.id });
    const elsewhere = await f.createWarehouse();
    await openPo(s, { quantity: 99, destinationWarehouseId: elsewhere.id }); // other warehouse

    await run().expect(201);
    const row = await prisma.aiSuggestion.findFirst();

    expect(row).toMatchObject({ onOrder: 25, onOrderMethod: "DESTINATION", suggestedQty: 55 }); // ceil(79.9 - 25)
    expect(row.inputs.onOrder).toMatchObject({ destinationQty: 25, unaddressedQty: 0, method: "DESTINATION" });
  });

  it("shares POs without a destination by forecast demand, floors it, and stores the exact value", async () => {
    const s = await scenario({ quantity: 5, daily: 30 });
    const second = await f.createWarehouse();
    await prisma.inventory.create({ data: { productId: s.product.id, warehouseId: second.id, quantity: 0 } });
    fake.setForecast(s.product.id, second.id, { dailyMean: 40, sigma: 1 }); // shares 3/7 and 4/7
    await openPo(s, { quantity: 100 });

    await run().expect(201);
    const rows = await prisma.aiSuggestion.findMany({ orderBy: { warehouseId: "asc" } });
    const mine = rows.find((r) => r.warehouseId === s.warehouse.id);

    expect(mine).toMatchObject({ onOrder: 42, onOrderMethod: "DEMAND_SHARE" });
    expect(mine.inputs.onOrder.exact).toBeCloseTo(42.857142, 5);
    expect(mine.inputs.onOrder).toMatchObject({ unaddressedQty: 100, rounding: "floor" });
    expect(rows.reduce((sum, r) => sum + r.onOrder, 0)).toBeLessThanOrEqual(100);
  });

  it("combines both and does not suggest when the open orders cover the need", async () => {
    const s = await scenario();
    await openPo(s, { quantity: 90, destinationWarehouseId: s.warehouse.id });

    const res = await run();

    expect(res.body.data.suggestions).toHaveLength(0);
    expect(res.body.data.counts.coveredByOnOrder).toBe(1);
  });
});

describe("when the AI service is unavailable", () => {
  it("answers 503, changes nothing and keeps the existing suggestions", async () => {
    await scenario();
    await run().expect(201);

    fake.state.down = true;
    const res = await run();

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/AI service/);
    expect((await prisma.aiSuggestion.findMany()).map((r) => r.status)).toEqual(["PENDING"]);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "REPLENISHMENT_RUN" } })).toBe(1);
  });

  it("does not affect ordinary ERP reads", async () => {
    fake.state.down = true;

    expect((await api().get("/api/v1/products")).status).toBe(200);
    expect((await api().get("/api/v1/ai/suggestions")).status).toBe(200);
  });
});

describe("GET /ai/suggestions", () => {
  it("lists with pagination and filters, for every role", async () => {
    await scenario();
    await scenario();
    await run().expect(201);
    await run().expect(201);

    const viewer = await createUser("VIEWER");
    const pending = await authed(app, viewer.token).get("/api/v1/ai/suggestions?status=PENDING&pageSize=1");

    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(pending.body.data[0]).toMatchObject({ status: "PENDING", product: { sku: expect.any(String) }, warehouse: { code: expect.any(String) }, supplier: { code: expect.any(String) } });
    expect((await api().get("/api/v1/ai/suggestions?status=EXPIRED")).body.pagination.total).toBe(2);
  });

  it.each(["status=NOPE", "productId=abc", "warehouseId=0", "pageSize=101"])("400 for %s", async (query) => {
    expect((await api().get(`/api/v1/ai/suggestions?${query}`)).status).toBe(400);
  });
});

describe("access", () => {
  it("only PROCUREMENT_OFFICER and ADMIN can run it", async () => {
    await scenario();

    for (const [role, status] of [["VIEWER", 403], ["WAREHOUSE_MANAGER", 403], ["PROCUREMENT_OFFICER", 201], ["ADMIN", 201]]) {
      expect((await run((await createUser(role)).token)).status).toBe(status);
    }

    expect((await require("supertest")(app).post("/api/v1/ai/replenishment/run").send({})).status).toBe(401);
  });

  it("rejects a body with unknown fields", async () => {
    expect((await api().post("/api/v1/ai/replenishment/run").send({ z: 3 })).status).toBe(400);
  });
});
