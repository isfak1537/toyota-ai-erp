const request = require("supertest");

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

describe("POST /ai/models/retrain", () => {
  it("trains through the AI service and records the active versions with their metrics", async () => {
    const admin = await createUser("ADMIN");

    const res = await authed(app, admin.token).post("/api/v1/ai/models/retrain").send({});

    expect(res.status).toBe(201);
    expect(fake.state.calls.find((c) => c.url === "/train").body).toEqual({});

    const runs = await prisma.aiModelRun.findMany({ orderBy: { id: "asc" } });
    expect(runs.map((r) => [r.modelType, r.version, r.isActive])).toEqual([["FORECAST", "forecast-test-0002", true], ["ANOMALY", "anomaly-test-0002", true]]);
    expect(runs[0].metrics).toEqual({ note: "fake" });
    expect(await prisma.aiAuditLog.findMany({ where: { eventType: "MODEL_RETRAIN" } })).toEqual([expect.objectContaining({ actorUserId: admin.user.id })]);
  });

  it("passes the requested models and as-of date; only one model type changes", async () => {
    await api().post("/api/v1/ai/models/retrain").send({ models: ["anomaly"], asOf: "2026-10-20" }).expect(201);

    expect(fake.state.calls.find((c) => c.url === "/train").body).toEqual({ models: ["anomaly"], asOf: "2026-10-20" });
    expect((await prisma.aiModelRun.findMany()).map((r) => r.modelType)).toEqual(["ANOMALY"]);
  });

  it("keeps one active run per type, and re-activates a version it has seen instead of duplicating it", async () => {
    await prisma.aiModelRun.create({ data: { modelType: "FORECAST", version: "forecast-old", metrics: {}, isActive: true } });

    await api().post("/api/v1/ai/models/retrain").send({ models: ["forecast"] }).expect(201);
    await api().post("/api/v1/ai/models/retrain").send({ models: ["forecast"] }).expect(201);

    const runs = await prisma.aiModelRun.findMany({ orderBy: { id: "asc" } });
    expect(runs.map((r) => [r.version, r.isActive])).toEqual([["forecast-old", false], ["forecast-test-0002", true]]);
  });

  it("503 and no record when the AI service is down; the old active model stays active", async () => {
    await prisma.aiModelRun.create({ data: { modelType: "FORECAST", version: "forecast-old", metrics: {}, isActive: true } });
    fake.state.down = true;

    expect((await api().post("/api/v1/ai/models/retrain").send({})).status).toBe(503);
    expect(await prisma.aiModelRun.count()).toBe(1);
    expect((await prisma.aiModelRun.findFirst()).isActive).toBe(true);
  });

  it.each([[{ models: [] }], [{ models: ["llm"] }], [{ asOf: "yesterday" }], [{ extra: 1 }]])("400 for %j", async (body) => {
    expect((await api().post("/api/v1/ai/models/retrain").send(body)).status).toBe(400);
  });

  it("is ADMIN only", async () => {
    for (const role of ["VIEWER", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER"]) {
      expect((await authed(app, (await createUser(role)).token).post("/api/v1/ai/models/retrain").send({})).status).toBe(403);
    }

    expect((await request(app).post("/api/v1/ai/models/retrain").send({})).status).toBe(401);
    expect(fake.state.calls).toHaveLength(0);
  });
});

describe("GET /ai/models", () => {
  it("lists model runs newest first with a type filter, for every role", async () => {
    await prisma.aiModelRun.create({ data: { modelType: "FORECAST", version: "f1", metrics: { mae: 1.3 }, trainedAt: new Date("2026-10-01") } });
    await prisma.aiModelRun.create({ data: { modelType: "ANOMALY", version: "a1", metrics: {}, trainedAt: new Date("2026-10-02") } });
    await prisma.aiModelRun.create({ data: { modelType: "FORECAST", version: "f2", metrics: {}, trainedAt: new Date("2026-10-03"), isActive: true } });
    const viewer = authed(app, (await createUser("VIEWER")).token);

    const all = await viewer.get("/api/v1/ai/models");
    expect(all.body.data.map((r) => r.version)).toEqual(["f2", "a1", "f1"]);
    expect((await viewer.get("/api/v1/ai/models?modelType=FORECAST")).body.data.map((r) => r.version)).toEqual(["f2", "f1"]);
    expect((await viewer.get("/api/v1/ai/models?modelType=NOPE")).status).toBe(400);
  });
});

describe("GET /ai/forecast/:productId", () => {
  it("returns the AI service's forecast for one warehouse", async () => {
    const s = await f.stockScenario({ quantity: 10 });
    fake.setForecast(s.product.id, s.warehouse.id, { dailyMean: 4, sigma: 1 });

    const res = await api().get(`/api/v1/ai/forecast/${s.product.id}?warehouseId=${s.warehouse.id}&horizonDays=14`);

    expect(res.status).toBe(200);
    expect(res.body.data.product).toMatchObject({ id: s.product.id, sku: s.product.sku });
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0]).toMatchObject({ warehouseId: s.warehouse.id, status: "OK", dailyMean: 4 });
    expect(fake.state.calls[0].body).toEqual({ series: [{ productId: s.product.id, warehouseId: s.warehouse.id }], horizonDays: 14 });
  });

  it("without a warehouse, forecasts every warehouse that stocks the product", async () => {
    const s = await f.stockScenario({ quantity: 10 });
    const other = await f.createWarehouse();
    await prisma.inventory.create({ data: { productId: s.product.id, warehouseId: other.id, quantity: 1 } });

    const res = await api().get(`/api/v1/ai/forecast/${s.product.id}`);

    expect(res.body.data.results.map((r) => r.warehouseId)).toEqual([s.warehouse.id, other.id]);
    expect(fake.state.calls[0].body.horizonDays).toBe(30);
  });

  it("a product with no inventory has an empty result and does not call the AI service", async () => {
    const product = await f.createProduct();

    const res = await api().get(`/api/v1/ai/forecast/${product.id}`);

    expect(res.body.data.results).toEqual([]);
    expect(fake.state.calls).toHaveLength(0);
  });

  it("404 for an unknown product or an unstocked warehouse; 400 for bad ids and horizons; 503 when the service is down", async () => {
    const s = await f.stockScenario({ quantity: 1 });
    const other = await f.createWarehouse();

    expect((await api().get("/api/v1/ai/forecast/999999")).status).toBe(404);
    expect((await api().get(`/api/v1/ai/forecast/${s.product.id}?warehouseId=${other.id}`)).status).toBe(404);
    expect((await api().get("/api/v1/ai/forecast/abc")).status).toBe(400);
    expect((await api().get(`/api/v1/ai/forecast/${s.product.id}?horizonDays=31`)).status).toBe(400);
    expect((await api().get(`/api/v1/ai/forecast/${s.product.id}?warehouseId=0`)).status).toBe(400);

    fake.state.down = true;
    expect((await api().get(`/api/v1/ai/forecast/${s.product.id}`)).status).toBe(503);
  });
});
