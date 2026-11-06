// `npm run demo:clear-explanations`: clears explanation text on PENDING suggestions only (AI-009).
const { main } = require("../../scripts/clear-explanations");
const { clearPendingExplanations } = require("../../src/modules/demo/clear-explanations");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

const suggestion = async (overrides = {}) => {
  const s = await f.stockScenario({ quantity: 10 });
  const supplier = await f.createSupplier();

  return prisma.aiSuggestion.create({
    data: {
      runId: "run-test", productId: s.product.id, warehouseId: s.warehouse.id, supplierId: supplier.id, suggestedQty: 42, forecastDaily: 10, sigma: 3, leadTimeDays: 4,
      minimumOrderQty: 10, safetyStock: 9.9, reorderPoint: 49.9, available: 10, onOrder: 0, onOrderMethod: "NONE", inputs: {}, zValue: 1.65, reviewDays: 7,
      forecastModel: "ML", modelVersion: "forecast-test-0001", explanation: "Old text.", explanationSource: "LLM:groq:test", ...overrides,
    },
  });
};

const seedRows = async () => ({
  pending: await suggestion(),
  pendingEmpty: await suggestion({ explanation: null, explanationSource: null }),
  rejected: await suggestion({ status: "REJECTED", rejectReason: "not needed" }),
});

const state = (id) => prisma.aiSuggestion.findUnique({ where: { id } });

describe("clear-explanations", () => {
  it("a dry run reports the count and writes nothing", async () => {
    const rows = await seedRows();
    const lines = [];

    expect(await main([], (l) => lines.push(l))).toBe(0);
    expect(lines.join("\n")).toMatch(/DRY RUN.*1 PENDING/);
    expect((await state(rows.pending.id)).explanation).toBe("Old text.");
  });

  it("--apply clears explanation and source of PENDING rows only", async () => {
    const rows = await seedRows();

    expect(await clearPendingExplanations({ apply: true })).toEqual({ applied: true, count: 1 });

    const pending = await state(rows.pending.id);
    expect([pending.explanation, pending.explanationSource, pending.suggestedQty, pending.status]).toEqual([null, null, 42, "PENDING"]);
    expect((await state(rows.rejected.id)).explanation).toBe("Old text.");
    expect((await state(rows.rejected.id)).explanationSource).toBe("LLM:groq:test");
  });

  it("a second run changes nothing", async () => {
    await seedRows();
    await clearPendingExplanations({ apply: true });

    expect(await clearPendingExplanations({ apply: true })).toEqual({ applied: true, count: 0 });
  });

  it("refuses to write to a non-local host without --allow-remote, but a dry run is allowed", async () => {
    const databaseUrl = "postgresql://u:p@db.example.com:5432/x";

    await expect(clearPendingExplanations({ apply: true, databaseUrl })).rejects.toThrow(/not local/);
    await expect(clearPendingExplanations({ apply: false, databaseUrl })).resolves.toMatchObject({ applied: false });
  });

  it("rejects an unknown option", async () => {
    expect(await main(["--everything"], () => {})).toBe(2);
  });
});
