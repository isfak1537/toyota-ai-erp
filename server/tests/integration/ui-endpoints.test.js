// Endpoints added for the UI: the replenishment review (latest run), days of cover, the audit log, ledger date filters.
const request = require("supertest");

const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { startFakeAiService } = require("../helpers/fake-ai-service");
const { installFakeLlm } = require("../helpers/fake-llm");
const { setLlm } = require("../../src/modules/ai/llm/llm.service");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

let fake;

beforeAll(async () => {
  fake = await startFakeAiService();
});
afterAll(async () => {
  setLlm(null);
  await fake.stop();
  await disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  fake.reset();
  setLlm(installFakeLlm().service);
});

const api = () => authed(app);
const run = () => api().post("/api/v1/ai/replenishment/run").send({}).expect(201);

const series = async ({ quantity = 40, reserved = 0, daily = 10, sigma = 3, link = {}, product = {}, supplier = true } = {}) => {
  const s = await f.stockScenario({ quantity, reserved, product });

  if (supplier) {
    const sup = await f.createSupplier();
    await prisma.supplierProduct.create({ data: { supplierId: sup.id, productId: s.product.id, unitPrice: "5.00", leadTimeDays: 4, minimumOrderQty: 50, isPreferred: true, ...link } });
    s.supplier = sup;
  }

  if (daily !== null) fake.setForecast(s.product.id, s.warehouse.id, { dailyMean: daily, sigma });

  return s;
};

describe("GET /ai/replenishment/latest", () => {
  it("is empty before any run", async () => {
    const res = await api().get("/api/v1/ai/replenishment/latest");

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("lists every evaluated series with its decision, reason and the numbers behind it", async () => {
    const ordered = await series({ quantity: 40, product: { reorderLevel: 99 } }); // available 40 <= ROP 49.9
    const fine = await series({ quantity: 200 }); // above the ROP
    const covered = await series({ quantity: 40 });
    const sup = await f.createSupplier();
    await f.createPurchaseOrder({ supplierId: sup.id, destinationWarehouseId: covered.warehouse.id, items: [{ productId: covered.product.id, quantity: 120 }] });
    const noHistory = await series({ daily: null });
    const noSupplier = await series({ supplier: false });
    const noLead = await series({ link: { leadTimeDays: null } });

    const run1 = (await run()).body.data;
    const res = await api().get("/api/v1/ai/replenishment/latest");
    const by = Object.fromEntries(res.body.data.series.map((x) => [x.productId, x]));

    expect(res.body.data).toMatchObject({ runId: run1.runId, modelVersion: "forecast-test-0001", params: { z: 1.65, reviewDays: 7 }, counts: { evaluated: 6, suggested: 1, notNeeded: 1, coveredByOnOrder: 1, skipped: 3 } });
    expect(res.body.data.series).toHaveLength(6);

    expect(by[ordered.product.id]).toMatchObject({
      decision: "ORDERED",
      sku: ordered.product.sku,
      warehouse: ordered.warehouse.code,
      staticReorderLevel: 99,
      available: 40,
      reorderPoint: 49.9,
      safetyStock: 9.9,
      dailyMean: 10,
      sigma: 3,
      leadTimeDays: 4,
      onOrder: 0,
      onOrderMethod: "NONE",
      suggestedQty: 80,
      daysOfCover: 4,
    });
    expect(by[ordered.product.id].suggestionId).toBe((await prisma.aiSuggestion.findFirst({ where: { productId: ordered.product.id } })).id);
    expect(by[ordered.product.id].reason).toMatch(/at or below the reorder point 49.9; suggesting 80 units/);

    expect(by[fine.product.id]).toMatchObject({ decision: "NOT_NEEDED", suggestedQty: null, suggestionId: null, daysOfCover: 20 });
    expect(by[fine.product.id].reason).toMatch(/above the reorder point 49.9/);

    expect(by[covered.product.id]).toMatchObject({ decision: "COVERED_BY_ON_ORDER", onOrder: 120, onOrderMethod: "DESTINATION" });
    expect(by[covered.product.id].reason).toMatch(/120 units already on order/);

    expect(by[noHistory.product.id]).toMatchObject({ decision: "SKIPPED", skipCode: "NO_HISTORY", reorderPoint: null, daysOfCover: null });
    expect(by[noSupplier.product.id]).toMatchObject({ decision: "SKIPPED", skipCode: "NO_SUPPLIER", daysOfCover: 4 }); // forecast exists, so cover is shown
    expect(by[noLead.product.id]).toMatchObject({ decision: "SKIPPED", skipCode: "NO_LEAD_TIME" });
    expect(by[noLead.product.id].reason).toMatch(/no lead time/);
  });

  it("returns the newest run, and is readable by every role", async () => {
    await series();
    await run();
    const second = (await run()).body.data;
    const viewer = authed(app, (await createUser("VIEWER")).token);

    const res = await viewer.get("/api/v1/ai/replenishment/latest");

    expect(res.status).toBe(200);
    expect(res.body.data.runId).toBe(second.runId);
    expect((await request(app).get("/api/v1/ai/replenishment/latest")).status).toBe(401);
  });

  it("the per-series detail is not returned by the run itself (it stays small) but is in the audit payload", async () => {
    await series();

    const res = await run();

    expect(res.body.data).not.toHaveProperty("series");
    expect((await prisma.aiAuditLog.findFirst({ where: { eventType: "REPLENISHMENT_RUN" } })).payload.series).toHaveLength(1);
  });
});

describe("GET /ai/days-of-cover", () => {
  it("returns days of cover soonest first for every stocked series", async () => {
    const slow = await series({ quantity: 100, daily: 2 });
    const fast = await series({ quantity: 30, daily: 10 });

    const res = await api().get("/api/v1/ai/days-of-cover");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ forecastAvailable: true, horizonDays: 30 });
    expect(res.body.data.items.map((i) => [i.sku, i.daysOfCover])).toEqual([[fast.product.sku, 3], [slow.product.sku, null]]);
  });

  it("answers 200 with forecastAvailable false and the low-stock fallback when the AI service is down", async () => {
    await f.stockScenario({ quantity: 2, product: { reorderLevel: 10 } });
    fake.state.down = true;

    const res = await api().get("/api/v1/ai/days-of-cover");

    expect(res.status).toBe(200);
    expect(res.body.data.forecastAvailable).toBe(false);
    expect(res.body.data.fallback.total).toBe(1);
  });

  it("filters by warehouse, validates its query and needs a login", async () => {
    const a = await series({ quantity: 10 });
    await series({ quantity: 20 });

    expect((await api().get(`/api/v1/ai/days-of-cover?warehouseCode=${a.warehouse.code}`)).body.data.items).toHaveLength(1);
    expect((await api().get("/api/v1/ai/days-of-cover?warehouseCode=NOPE")).status).toBe(404);
    expect((await api().get("/api/v1/ai/days-of-cover?limit=0")).status).toBe(400);
    expect((await api().get("/api/v1/ai/days-of-cover?limit=101")).status).toBe(400);
    expect((await request(app).get("/api/v1/ai/days-of-cover")).status).toBe(401);
    expect((await authed(app, (await createUser("VIEWER")).token).get("/api/v1/ai/days-of-cover")).status).toBe(200);
  });
});

describe("GET /ai/audit (ADMIN)", () => {
  it("lists newest first with the actor, filters by event type and summarises the types", async () => {
    await series();
    const officer = await createUser("PROCUREMENT_OFFICER", { name: "Olivia Officer" });
    await authed(app, officer.token).post("/api/v1/ai/replenishment/run").send({}).expect(201);
    await prisma.aiAuditLog.create({ data: { eventType: "MODEL_RETRAIN", payload: { versions: [] } } });

    const all = await api().get("/api/v1/ai/audit");

    expect(all.status).toBe(200);
    expect(all.body.data[0].eventType).toBe("MODEL_RETRAIN");
    expect(all.body.eventTypes).toEqual(expect.arrayContaining([{ eventType: "REPLENISHMENT_RUN", count: 1 }, { eventType: "MODEL_RETRAIN", count: 1 }]));

    const runs = await api().get("/api/v1/ai/audit?eventType=REPLENISHMENT_RUN");
    expect(runs.body.data).toHaveLength(1);
    expect(runs.body.data[0]).toMatchObject({ actor: { name: "Olivia Officer", role: "PROCUREMENT_OFFICER" } });
    expect(runs.body.data[0].payload).toMatchObject({ seriesCount: 1, counts: { suggested: 1 } });
    expect(runs.body.data[0].payload).not.toHaveProperty("series");
    expect(runs.body.pagination.total).toBe(1);
  });

  it("paginates and validates", async () => {
    await prisma.aiAuditLog.createMany({ data: Array.from({ length: 5 }, () => ({ eventType: "ANOMALY_SYNC", payload: {} })) });

    const page = await api().get("/api/v1/ai/audit?pageSize=2&page=3");

    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toMatchObject({ total: 5, totalPages: 3 });
    expect((await api().get("/api/v1/ai/audit?pageSize=101")).status).toBe(400);
  });

  it("is ADMIN only", async () => {
    for (const role of ["VIEWER", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER"]) {
      expect((await authed(app, (await createUser(role)).token).get("/api/v1/ai/audit")).status).toBe(403);
    }

    expect((await request(app).get("/api/v1/ai/audit")).status).toBe(401);
  });
});

describe("GET /inventory/transactions date filters", () => {
  const at = (iso) => ({ createdAt: new Date(iso) });

  it("from is inclusive and to is exclusive, and the actor comes with each row", async () => {
    const s = await f.stockScenario({ quantity: 10 });
    const manager = await createUser("WAREHOUSE_MANAGER", { name: "Wanda Warehouse" });
    const row = (iso, extra = {}) => prisma.inventoryTransaction.create({ data: { productId: s.product.id, warehouseId: s.warehouse.id, type: "ISSUE", quantity: -1, balanceAfter: 9, ...at(iso), ...extra } });
    await row("2026-10-01T00:00:00Z");
    await row("2026-10-02T00:00:00Z", { createdById: manager.user.id });
    await row("2026-10-03T00:00:00Z");

    const ids = async (query) => (await api().get(`/api/v1/inventory/transactions?${query}`)).body.data.map((t) => t.createdAt.slice(0, 10));

    expect(await ids("from=2026-10-02T00:00:00Z&to=2026-10-03T00:00:00Z")).toEqual(["2026-10-02"]);
    expect(await ids("from=2026-10-02")).toEqual(["2026-10-03", "2026-10-02"]);
    expect(await ids("to=2026-10-02T00:00:00Z")).toEqual(["2026-10-01"]);

    const withActor = (await api().get("/api/v1/inventory/transactions?from=2026-10-02&to=2026-10-03")).body.data[0];
    expect(withActor.createdBy).toMatchObject({ name: "Wanda Warehouse", role: "WAREHOUSE_MANAGER" });
  });

  it.each(["from=garbage", "to=2026-13-45", "from=2026-10-03&to=2026-10-03", "from=2026-10-04&to=2026-10-01"])("400 for %s", async (query) => {
    expect((await api().get(`/api/v1/inventory/transactions?${query}`)).status).toBe(400);
  });
});

describe("procurement lists carry the destination warehouse", () => {
  it("returns it with requisitions and purchase orders (the UI shows where goods are going)", async () => {
    const ctx = { product: await f.createProduct(), supplier: await f.createSupplier(), warehouse: await f.createWarehouse() };
    const pr = await api().post("/api/v1/procurement/requisitions").send({ requesterName: "T", supplierId: ctx.supplier.id, destinationWarehouseId: ctx.warehouse.id, items: [{ productId: ctx.product.id, quantity: 5, estimatedUnitPrice: 2 }] }).expect(201);
    await api().post(`/api/v1/procurement/requisitions/${pr.body.data.id}/submit`).expect(200);
    await api().post(`/api/v1/procurement/requisitions/${pr.body.data.id}/approve`).expect(200);
    await api().post("/api/v1/procurement/purchase-orders").send({ supplierId: ctx.supplier.id, requisitionId: pr.body.data.id, items: [{ productId: ctx.product.id, quantity: 5, unitPrice: 2 }] }).expect(201);

    const requisitions = await api().get("/api/v1/procurement/requisitions");
    const orders = await api().get("/api/v1/procurement/purchase-orders");

    expect(pr.body.data.destinationWarehouse).toMatchObject({ code: ctx.warehouse.code });
    expect(requisitions.body.data[0].destinationWarehouse).toMatchObject({ code: ctx.warehouse.code });
    expect(orders.body.data[0].destinationWarehouse).toMatchObject({ code: ctx.warehouse.code });
  });
});
