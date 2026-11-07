// PRD 9.1 / 12.1: the AI-assisted procure-to-stock loop through the HTTP API with the roles the SRS gives each step,
// then the reconcile script. Also NFR-014: the same loop with the LLM switched off or failing.
const request = require("supertest");

const app = require("../../src/app");
const { reconcile, main: reconcileMain } = require("../../scripts/reconcile");
const { authed } = require("../helpers/http");
const inventoryService = require("../../src/services/inventory.service");
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

// forecast d=10, sigma=3, lead 4, MOQ 50, available 40 -> a suggestion for 80 units
const scenario = async () => {
  const s = await f.stockScenario({ quantity: 0 });
  await inventoryService.receiveStock({ productId: s.product.id, warehouseId: s.warehouse.id, quantity: 40 }); // opening stock through the service, so the ledger is complete
  const supplier = await f.createSupplier();
  await prisma.supplierProduct.create({ data: { supplierId: supplier.id, productId: s.product.id, unitPrice: "5.00", leadTimeDays: 4, minimumOrderQty: 50, isPreferred: true } });
  fakeAi.setForecast(s.product.id, s.warehouse.id, { dailyMean: 10, sigma: 3 });

  return { ...s, supplier };
};

const onHand = async (productId, warehouseId) => (await prisma.inventory.findFirst({ where: { productId, warehouseId } })).quantity;

// Runs the whole loop and returns what it produced, asserting each step with the role that owns it.
const runLoop = async (s) => {
  const officer = await createUser("PROCUREMENT_OFFICER");
  const keeper = await createUser("WAREHOUSE_MANAGER");
  const asOfficer = () => authed(app, officer.token);
  const asKeeper = () => authed(app, keeper.token);
  const before = await onHand(s.product.id, s.warehouse.id);

  const run = await asOfficer().post("/api/v1/ai/replenishment/run").send({});
  expect(run.status).toBe(201);
  expect(run.body.data.counts).toMatchObject({ suggested: 1 });
  const suggestion = await prisma.aiSuggestion.findFirst();
  expect(suggestion).toMatchObject({ status: "PENDING", suggestedQty: 80 });
  expect(await prisma.purchaseRequisition.count()).toBe(0); // AI wrote no business record

  const approved = await asOfficer().post(`/api/v1/ai/suggestions/${suggestion.id}/approve`).send({});
  expect(approved.status).toBe(201);
  const requisition = await prisma.purchaseRequisition.findFirst({ include: { items: true } });
  expect(requisition).toMatchObject({ status: "DRAFT", sourceType: "AI_SUGGESTION", sourceId: suggestion.id, supplierId: s.supplier.id });
  expect((await prisma.aiSuggestion.findUnique({ where: { id: suggestion.id } })).requisitionId).toBe(requisition.id);

  await asOfficer().post(`/api/v1/procurement/requisitions/${requisition.id}/submit`).expect(200);
  await asOfficer().post(`/api/v1/procurement/requisitions/${requisition.id}/approve`).expect(200);
  expect((await prisma.purchaseRequisition.findUnique({ where: { id: requisition.id } })).approvedById).toBe(officer.user.id);

  const order = await asOfficer()
    .post("/api/v1/procurement/purchase-orders")
    .send({ supplierId: s.supplier.id, requisitionId: requisition.id, destinationWarehouseId: s.warehouse.id, items: [{ productId: s.product.id, quantity: 80, unitPrice: 5 }] });
  expect(order.status).toBe(201);
  const po = order.body.data;
  await asOfficer().post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).expect(200);

  const receipt = await asKeeper()
    .post("/api/v1/procurement/goods-receipts")
    .send({ purchaseOrderId: po.id, items: [{ purchaseOrderItemId: po.items[0].id, productId: s.product.id, quantity: 80 }] });
  expect(receipt.status).toBe(201);

  expect(await onHand(s.product.id, s.warehouse.id)).toBe(before + 80);
  const ledger = await prisma.inventoryTransaction.findFirst({ where: { productId: s.product.id, warehouseId: s.warehouse.id, type: "RECEIPT" }, orderBy: { id: "desc" } });
  expect(ledger).toMatchObject({ quantity: 80, balanceAfter: before + 80 });
  expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("RECEIVED");

  return { suggestion, officer, keeper };
};

const expectReconciled = async () => {
  const report = await reconcile(prisma, { scope: "all", strict: true });
  expect({ ok: report.ok, errors: report.errors, warnings: report.warnings }).toEqual({ ok: true, errors: 0, warnings: 0 });

  const lines = [];
  expect(await reconcileMain([], { prisma, log: (l) => lines.push(l) })).toBe(0);
  if (process.env.SHOW_RECONCILE) process.stdout.write(`${lines.join("\n")}\n`);
  expect(lines.join("\n")).toMatch(/Result: OK/);
};

describe("AI-assisted procure-to-stock loop (PRD 9.1, 12.1)", () => {
  it("suggestion -> draft requisition -> approved -> PO -> goods receipt: stock up, ledger row, reconcile OK", async () => {
    const s = await scenario();

    const { suggestion } = await runLoop(s);

    const stored = await prisma.aiSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(stored).toMatchObject({ explanation: expect.any(String), explanationSource: "LLM:fakegroq:fake-model" }); // inputs and explanation travel with it
    expect(stored.inputs).toMatchObject({ rawQty: 80 });
    await expectReconciled();
  });

  it("with the LLM key unset the whole loop still works and explanations stay empty (NFR-014)", async () => {
    setLlm(createLlmService({ providers: [], limiter: { tryAcquire: async () => null } }));
    const s = await scenario();

    const { suggestion, officer } = await runLoop(s);

    expect(await prisma.aiSuggestion.findUnique({ where: { id: suggestion.id } })).toMatchObject({ explanation: null, explanationSource: null });
    const explain = await authed(app, officer.token).post(`/api/v1/ai/suggestions/${suggestion.id}/explain`).send({});
    expect(explain.body).toMatchObject({ message: "Explanation unavailable", data: { explanation: null } });
    await expectReconciled();
  });

  it("with the LLM rejecting every call (invalid key) the loop and the assistant still work, answer null (NFR-014)", async () => {
    llm.state.fail = true;
    const s = await scenario();

    const { suggestion, officer } = await runLoop(s);

    expect(await prisma.aiSuggestion.findUnique({ where: { id: suggestion.id } })).toMatchObject({ explanation: null });
    const ask = await authed(app, officer.token).post("/api/v1/ai/ask").send({ question: "Which products are low on stock?" });
    expect(ask.status).toBe(200);
    expect(ask.body.data).toMatchObject({ answer: null, unavailable: true });
    expect((await authed(app, officer.token).get("/api/v1/ai/suggestions?status=APPROVED")).status).toBe(200);
    await expectReconciled();
  });

  it("without a login none of the loop's steps is reachable", async () => {
    for (const [method, path] of [["post", "/api/v1/ai/replenishment/run"], ["post", "/api/v1/ai/suggestions/1/approve"], ["post", "/api/v1/procurement/goods-receipts"]]) {
      expect((await request(app)[method](path).send({})).status).toBe(401);
    }
  });
});
