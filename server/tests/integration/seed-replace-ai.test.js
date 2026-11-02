// --replace must also clear what a demo of the AI module leaves behind (suggestions, anomaly flags,
// requisitions and POs of seed products, the receipts made from them, the audit rows of those actions),
// leave everything that is not seed-owned alone, and end in a consistent state.
const { main } = require("../../prisma/seed/generate");
const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const suggestionService = require("../../src/modules/ai/suggestion.service");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const run = async (args) => {
  const lines = [];
  const code = await main(args, { prisma, log: (line) => lines.push(String(line)) });

  return { code, output: lines.join("\n") };
};

beforeEach(resetDatabase);
afterAll(disconnect);

const api = () => authed(app);

// One link (product, warehouse with stock, supplier) taken from the seed itself.
const seedTriple = async () => {
  const link = await prisma.supplierProduct.findFirst({ where: { product: { sku: { startsWith: "SYN-" } } }, include: { product: true, supplier: true }, orderBy: { id: "asc" } });
  const inventory = await prisma.inventory.findFirst({ where: { productId: link.productId, warehouse: { code: { startsWith: "SYN-" } } }, include: { warehouse: true } });

  return { link, product: link.product, supplier: link.supplier, warehouse: inventory.warehouse };
};

const suggestionFor = (t, extra = {}) =>
  prisma.aiSuggestion.create({
    data: { runId: "demo", productId: t.product.id, warehouseId: t.warehouse.id, supplierId: t.supplier.id, suggestedQty: 30, forecastDaily: 5, sigma: 1, leadTimeDays: t.link.leadTimeDays ?? 3, minimumOrderQty: 1, safetyStock: 2, reorderPoint: 20, available: 5, onOrder: 0, onOrderMethod: "NONE", inputs: {}, zValue: 1.65, reviewDays: 7, forecastModel: "ML", modelVersion: "f-1", ...extra },
  });

// approve a suggestion and carry it all the way to a goods receipt, like the live demo does
const demoFlow = async (t) => {
  const admin = await createUser("ADMIN");
  const suggestion = await suggestionFor(t);
  const { requisition } = await suggestionService.approveSuggestion(suggestion.id, admin.user);
  const http = authed(app, admin.token);

  await http.post(`/api/v1/procurement/requisitions/${requisition.id}/submit`).expect(200);
  await http.post(`/api/v1/procurement/requisitions/${requisition.id}/approve`).expect(200);
  const po = (await http.post("/api/v1/procurement/purchase-orders").send({ supplierId: t.supplier.id, requisitionId: requisition.id, items: [{ productId: t.product.id, quantity: 30, unitPrice: 4 }] }).expect(201)).body.data;
  await http.post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).expect(200);
  await http.post("/api/v1/procurement/goods-receipts").send({ purchaseOrderId: po.id, items: [{ purchaseOrderItemId: po.items[0].id, productId: t.product.id, quantity: 30 }] }).expect(201);

  const ledgerRow = await prisma.inventoryTransaction.findFirst({ where: { productId: t.product.id, warehouseId: t.warehouse.id }, orderBy: { id: "asc" } });
  await prisma.anomalyFlag.create({ data: { inventoryTransactionId: ledgerRow.id, score: 0.9, reason: "demo", source: "RULE", ruleCodes: ["R2"] } });

  return { requisition, po };
};

const aiRows = async () => ({
  suggestions: await prisma.aiSuggestion.count(),
  flags: await prisma.anomalyFlag.count(),
  requisitions: await prisma.purchaseRequisition.count(),
  requisitionItems: await prisma.purchaseRequisitionItem.count(),
  aiAudit: await prisma.aiAuditLog.count({ where: { eventType: { in: ["REPLENISHMENT_RUN", "SUGGESTION_APPROVED", "SUGGESTION_REJECTED", "ANOMALY_SYNC", "ANOMALY_REVIEWED", "ASSISTANT_QUESTION"] } } }),
});

describe("--replace after a demo of the AI module", () => {
  it("clears suggestions, flags, requisitions, POs, receipts and the audit of those actions, and ends consistent", async () => {
    expect((await run(["--apply"])).code).toBe(0);
    const pristine = await prisma.inventoryTransaction.count();
    const t = await seedTriple();
    await demoFlow(t);
    await prisma.aiAuditLog.createMany({ data: [{ eventType: "LLM_CALL", payload: { success: true } }, { eventType: "MODEL_RETRAIN", payload: {} }] });

    expect(await aiRows()).toMatchObject({ suggestions: 1, flags: 1, requisitions: 1, requisitionItems: 1 });
    expect((await aiRows()).aiAudit).toBeGreaterThan(0);
    expect(await prisma.inventoryTransaction.count()).toBe(pristine + 1); // the receipt the demo made

    const replaced = await run(["--apply", "--replace"]);

    expect(replaced.code).toBe(0); // includes the reconcile of the reloaded seed
    expect(replaced.output).toMatch(/Deleted seed-owned rows/);
    expect(replaced.output).toMatch(/Result: OK/);
    expect(await aiRows()).toEqual({ suggestions: 0, flags: 0, requisitions: 0, requisitionItems: 0, aiAudit: 0 });
    expect(await prisma.inventoryTransaction.count()).toBe(pristine);
    expect(await prisma.goodsReceipt.count({ where: { receiptNumber: { not: { startsWith: "GR-SYN-" } } } })).toBe(0);
    expect(await prisma.purchaseOrder.count({ where: { poNumber: { not: { startsWith: "PO-SYN-" } } } })).toBe(0);
  });

  it("keeps what is not the demo's: LLM call accounting, model-run audit rows, users, and manual AI rows on manual data", async () => {
    await run(["--apply"]);
    const t = await seedTriple();
    await demoFlow(t);

    // manual data with its own AI rows: a product, supplier, warehouse and a suggestion and requisition on them
    const manual = await f.stockScenario({ quantity: 10 });
    const supplier = await f.createSupplier();
    const manualSuggestion = await prisma.aiSuggestion.create({
      data: { runId: "manual", productId: manual.product.id, warehouseId: manual.warehouse.id, supplierId: supplier.id, suggestedQty: 5, forecastDaily: 1, sigma: 1, leadTimeDays: 2, minimumOrderQty: 1, safetyStock: 1, reorderPoint: 3, available: 1, onOrder: 0, onOrderMethod: "NONE", inputs: {}, zValue: 1.65, reviewDays: 7, forecastModel: "ML", modelVersion: "f-1" },
    });
    const manualRequisition = await f.createRequisition({ supplierId: supplier.id, items: [{ productId: manual.product.id, quantity: 3 }] });
    await prisma.aiAuditLog.createMany({ data: [{ eventType: "LLM_CALL", payload: {} }, { eventType: "LLM_SKIPPED", payload: {} }, { eventType: "MODEL_RETRAIN", payload: {} }] });
    const users = await prisma.user.count();

    expect((await run(["--apply", "--replace"])).code).toBe(0);

    expect(await prisma.aiSuggestion.findUnique({ where: { id: manualSuggestion.id } })).not.toBeNull();
    expect(await prisma.purchaseRequisition.findUnique({ where: { id: manualRequisition.id } })).not.toBeNull();
    expect(await prisma.aiAuditLog.count({ where: { eventType: { in: ["LLM_CALL", "LLM_SKIPPED", "MODEL_RETRAIN"] } } })).toBe(3);
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.aiSuggestion.count()).toBe(1);
  });

  it("is repeatable: a second demo and a second replace work the same", async () => {
    await run(["--apply"]);

    for (let i = 0; i < 2; i += 1) {
      await demoFlow(await seedTriple());
      expect((await run(["--apply", "--replace"])).code).toBe(0);
      expect(await aiRows()).toEqual({ suggestions: 0, flags: 0, requisitions: 0, requisitionItems: 0, aiAudit: 0 });
    }
  });
});

describe("--replace still refuses to touch someone else's data", () => {
  it("refuses, and deletes nothing, when a requisition mixes a seed product with a manual one", async () => {
    await run(["--apply"]);
    const t = await seedTriple();
    const manual = await f.createProduct();
    await f.createRequisition({ items: [{ productId: t.product.id, quantity: 1 }, { productId: manual.id, quantity: 1 }] });
    const before = await prisma.inventoryTransaction.count();

    const { code, output } = await run(["--apply", "--replace"]);

    expect(code).toBe(2);
    expect(output).toMatch(/requisitions mixing SYN- and other products or suppliers/);
    expect(await prisma.inventoryTransaction.count()).toBe(before);
    expect(await prisma.purchaseRequisition.count()).toBe(1);
  });

  it("refuses when a requisition has a seed product but a manual supplier", async () => {
    await run(["--apply"]);
    const t = await seedTriple();
    const manualSupplier = await f.createSupplier();
    await f.createRequisition({ supplierId: manualSupplier.id, items: [{ productId: t.product.id, quantity: 1 }] });

    const { code, output } = await run(["--apply", "--replace"]);

    expect(code).toBe(2);
    expect(output).toMatch(/requisitions mixing/);
  });

  it("refuses when a manual purchase order was created from a seed requisition", async () => {
    await run(["--apply"]);
    const t = await seedTriple();
    const requisition = await f.createRequisition({ status: "APPROVED", supplierId: t.supplier.id, items: [{ productId: t.product.id, quantity: 4 }] });
    const manualSupplier = await f.createSupplier();
    await f.createPurchaseOrder({ supplierId: manualSupplier.id, requisitionId: requisition.id, items: [{ productId: t.product.id, quantity: 4 }] });

    const { code, output } = await run(["--apply", "--replace"]);

    expect(code).toBe(2);
    expect(output).toMatch(/non-seed purchase orders created from a SYN- requisition/);
    expect(await prisma.purchaseRequisition.findUnique({ where: { id: requisition.id } })).not.toBeNull();
  });

  it("audit rows alone do not count as seed data: a plain --apply works on a database that only has them", async () => {
    await prisma.aiAuditLog.create({ data: { eventType: "REPLENISHMENT_RUN", payload: {} } });

    const first = await run(["--apply"]);

    expect(first.code).toBe(0);
    expect(first.output).not.toMatch(/Refusing to write/);
  });
});
