// AI-009: explanations come from computed facts only, are cached, and never break a feature (NFR-014).
const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { startFakeAiService } = require("../helpers/fake-ai-service");
const { installFakeLlm } = require("../helpers/fake-llm");
const { setLlm, createLlmService } = require("../../src/modules/ai/llm/llm.service");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

let fakeAi;
let llm;

beforeAll(async () => {
  fakeAi = await startFakeAiService();
});
afterAll(async () => {
  setLlm(null);
  await fakeAi.stop();
  await disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  fakeAi.reset();
  llm = installFakeLlm();
  setLlm(llm.service);
});

const api = () => authed(app);

const scenario = async (overrides = {}) => {
  const s = await f.stockScenario({ quantity: 40, product: { name: "Brake Pad Set", sku: `SKU-${Math.random().toString(36).slice(2, 8)}` }, ...overrides });
  const sup = await f.createSupplier({ name: "Acme Parts" });
  await prisma.supplierProduct.create({ data: { supplierId: sup.id, productId: s.product.id, unitPrice: "5.00", leadTimeDays: 4, minimumOrderQty: 50, isPreferred: true } });
  fakeAi.setForecast(s.product.id, s.warehouse.id, { dailyMean: 10, sigma: 3 });

  return { ...s, supplier: sup };
};

describe("suggestion explanations", () => {
  it("a run stores the LLM's explanation with its source (provider and model)", async () => {
    await scenario();

    const res = await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);

    const row = await prisma.aiSuggestion.findFirst();
    expect(row.explanation).toBe("Stock is below the reorder point, so an order is suggested.");
    expect(row.explanationSource).toBe("LLM:fakegroq:fake-model");
    expect(res.body.data.suggestions[0]).toMatchObject({ explanation: row.explanation, explanationSource: "LLM:fakegroq:fake-model" });
    expect(res.body.data.counts.explained).toBe(1);
  });

  it("gives the model only computed facts: the numbers of the suggestion, quoted, and an instruction not to compute", async () => {
    const s = await scenario();
    await createUser("ADMIN", { email: "secret.person@example.com" });

    await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);

    const [request] = llm.state.requests;
    const [system, user] = request.messages;
    const facts = JSON.parse(user.content.split("Facts (JSON):\n")[1]);

    expect(system.content).toMatch(/ONLY the facts/);
    expect(system.content).toMatch(/never calculate/);
    expect(facts).toMatchObject({
      product: `${s.product.sku} Brake Pad Set`,
      warehouse: s.warehouse.code,
      supplier: "Acme Parts",
      availableUnits: 40,
      onOrderUnits: 0,
      forecastUnitsPerDay: 10,
      uncertaintyPerDay: 3,
      leadTimeDays: 4,
      reviewDays: 7,
      safetyStockUnits: 9.9,
      reorderPointUnits: 49.9,
      minimumOrderQty: 50,
      suggestedOrderQty: 80,
      forecastModel: "machine-learning model",
    });
    expect(JSON.stringify(request)).not.toMatch(/secret\.person|passwordHash|Bearer|apiKey/i);
  });

  it("an LLM failure leaves explanation null and the suggestion fully usable (NFR-014)", async () => {
    await scenario();
    llm.state.fail = true;

    const res = await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);
    const row = await prisma.aiSuggestion.findFirst();

    expect(res.body.data.suggestions).toHaveLength(1);
    expect(row).toMatchObject({ status: "PENDING", explanation: null, explanationSource: null, suggestedQty: 80 });

    const approved = await api().post(`/api/v1/ai/suggestions/${row.id}/approve`).send({});
    expect(approved.status).toBe(201);
  });

  it("works with the LLM switched off (no provider configured)", async () => {
    await scenario();
    setLlm(createLlmService({ providers: [], limiter: { tryAcquire: async () => null } }));

    const res = await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);

    expect(res.body.data.suggestions[0].explanation).toBeNull();
    expect(res.body.data.counts.explained).toBe(0);
  });

  it("is cached: asking again does not call the LLM", async () => {
    await scenario();
    await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);
    const id = (await prisma.aiSuggestion.findFirst()).id;

    const again = await api().post(`/api/v1/ai/suggestions/${id}/explain`).send({});

    expect(again.body.data).toMatchObject({ cached: true, explanation: expect.any(String) });
    expect(llm.state.requests).toHaveLength(1);
  });

  it("can be requested later when the run could not get one, and says 'unavailable' while the LLM is down", async () => {
    await scenario();
    llm.state.fail = true;
    await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);
    const id = (await prisma.aiSuggestion.findFirst()).id;

    const down = await api().post(`/api/v1/ai/suggestions/${id}/explain`).send({});
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ message: "Explanation unavailable", data: { explanation: null, explanationSource: null } });

    llm.state.fail = false;
    const up = await api().post(`/api/v1/ai/suggestions/${id}/explain`).send({});
    expect(up.body.data).toMatchObject({ cached: false, explanationSource: "LLM:fakegroq:fake-model" });
  });

  it("404 for an unknown suggestion, 403 for a VIEWER", async () => {
    expect((await api().post("/api/v1/ai/suggestions/999999/explain").send({})).status).toBe(404);
    expect((await authed(app, (await createUser("VIEWER")).token).post("/api/v1/ai/suggestions/1/explain").send({})).status).toBe(403);
  });

  it("every LLM call is audited with provider, model, purpose and outcome, and the audit holds no prompt", async () => {
    await scenario();
    const officer = await createUser("PROCUREMENT_OFFICER");

    await authed(app, officer.token).post("/api/v1/ai/replenishment/run").send({}).expect(201);

    const audit = await prisma.aiAuditLog.findMany({ where: { eventType: "LLM_CALL" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: officer.user.id });
    expect(audit[0].payload).toMatchObject({ provider: "fakegroq", model: "fake-model", purpose: "explain_suggestion", success: true });
    expect(JSON.stringify(audit[0].payload)).not.toMatch(/Brake Pad|Acme/);
  });

  it("the daily cap counts today's LLM calls from the audit log and skips the LLM past it", async () => {
    await scenario();
    const { createLlmService: build, createRateLimiter } = require("../../src/modules/ai/llm/llm.service");
    const limiter = createRateLimiter({ perMinute: 100, perDay: 2, callsToday: () => prisma.aiAuditLog.count({ where: { eventType: "LLM_CALL" } }) });
    setLlm(build({ providers: llm.service.providers, limiter }));
    await prisma.aiAuditLog.createMany({ data: [{ eventType: "LLM_CALL", payload: {} }, { eventType: "LLM_CALL", payload: {} }] });

    await api().post("/api/v1/ai/replenishment/run").send({}).expect(201);

    expect((await prisma.aiSuggestion.findFirst()).explanation).toBeNull();
    expect(llm.state.requests).toHaveLength(0);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "LLM_SKIPPED" } })).toBeGreaterThan(0);
  });
});

describe("anomaly explanations", () => {
  const rows = async (n) => {
    const s = await f.stockScenario({ quantity: 100 });
    const out = [];

    for (let i = 0; i < n; i += 1) {
      out.push(await prisma.inventoryTransaction.create({ data: { productId: s.product.id, warehouseId: s.warehouse.id, type: "ISSUE", quantity: -8, balanceAfter: 90 - i } }));
    }

    return out;
  };
  const flag = (id, extra = {}) => ({ inventoryTransactionId: id, score: 0.9, source: "RULE", ruleCodes: ["R2"], queueRank: null, period: "2026-11-01/2026-11-07", topFeatures: [], reason: "Issue of 8 units is 8.0x the usual 1", ...extra });
  const sync = () => api().post("/api/v1/ai/anomalies/sync").send({});

  it("a sync explains new flags from the transaction and the detector's own reason", async () => {
    const [a] = await rows(1);
    fakeAi.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id, { source: "BOTH", queueRank: 3, topFeatures: [{ feature: "size as a multiple of the usual", value: 8, typical: 1, contribution: 0.3 }] })] };

    const res = await sync();

    const stored = await prisma.anomalyFlag.findFirst();
    expect(res.body.data.explained).toBe(1);
    expect(stored).toMatchObject({ explanationSource: "LLM:fakegroq:fake-model" });

    const facts = JSON.parse(llm.state.requests[0].messages[1].content.split("Facts (JSON):\n")[1]);
    expect(facts).toMatchObject({ movementType: "ISSUE", units: -8, flaggedBy: "rules and the model", ruleCodes: ["R2"], reviewQueueRank: 3, detectorReason: "Issue of 8 units is 8.0x the usual 1" });
    expect(facts.mostUnusualAspects).toEqual([{ aspect: "size as a multiple of the usual", value: 8, typical: 1 }]);
  });

  it("explains at most 20 flags per sync (highest scores first) and leaves the rest for on-demand requests", async () => {
    const list = await rows(25);
    fakeAi.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 25, flags: list.map((r, i) => flag(r.id, { score: 0.5 + i / 100 })) };

    const res = await sync();

    expect(res.body.data.explained).toBe(20);
    const unexplained = await prisma.anomalyFlag.findMany({ where: { explanation: null } });
    expect(unexplained).toHaveLength(5);
    expect(Math.max(...unexplained.map((x) => x.score))).toBeLessThan(0.55); // the five lowest scores
  });

  it("a re-sync keeps the cached explanation unless the detectors changed", async () => {
    const [a] = await rows(1);
    fakeAi.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id)] };
    await sync();
    await sync();
    expect(llm.state.requests).toHaveLength(1);

    fakeAi.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id, { source: "BOTH", ruleCodes: ["R2", "R4"], queueRank: 1 })] };
    llm.state.reply = "New explanation after the detectors changed.";
    await sync();

    expect(llm.state.requests).toHaveLength(2);
    expect((await prisma.anomalyFlag.findFirst()).explanation).toBe("New explanation after the detectors changed.");
  });

  it("an LLM failure never fails the sync, and the on-demand endpoint works afterwards", async () => {
    const [a] = await rows(1);
    fakeAi.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id)] };
    llm.state.fail = true;

    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 1, explained: 0 });

    llm.state.fail = false;
    const id = (await prisma.anomalyFlag.findFirst()).id;
    const later = await api().post(`/api/v1/ai/anomalies/${id}/explain`).send({});
    expect(later.body.data).toMatchObject({ cached: false, explanationSource: "LLM:fakegroq:fake-model" });
    expect((await api().post("/api/v1/ai/anomalies/999999/explain").send({})).status).toBe(404);
  });
});
