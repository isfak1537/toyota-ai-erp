// `npm run demo:prepare` / `demo:undo`: stage the demo through the inventory service, and put it back.
const { prepare, undo, PREPARE, UNDO, DEFAULT_SKUS } = require("../../src/modules/demo/demo-prepare");
const { main } = require("../../scripts/demo");
const { main: seedMain } = require("../../prisma/seed/generate");
const { reconcile } = require("../../scripts/reconcile");
const { buildDataset } = require("../../prisma/seed/build");
const { writeDataset } = require("../../prisma/seed/writer");
const { runReplenishment } = require("../../src/modules/ai/replenishment.service");
const { computeReplenishment } = require("../../src/modules/ai/replenishment");
const { startFakeAiService } = require("../helpers/fake-ai-service");
const { createUser } = require("../helpers/auth");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

let fake;
const dataset = buildDataset();

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
  await writeDataset(prisma, dataset);
  await createUser("ADMIN", { email: "admin@demo.synthetic" });
});

const sku = (s) => prisma.product.findUnique({ where: { sku: s } });

// forecasts for every warehouse a product is stocked in: 3 units/day, sigma 1 (the seed's stock is above the reorder point that gives)
const forecastAll = async (skus = DEFAULT_SKUS, daily = 3, sigma = 1) => {
  for (const s of skus) {
    const product = await sku(s);

    for (const row of await prisma.inventory.findMany({ where: { productId: product.id } })) fake.setForecast(product.id, row.warehouseId, { dailyMean: daily, sigma });
  }
};

const stockOf = async (s, code = "SYN-MAIN") => {
  const row = await prisma.inventory.findFirst({ where: { product: { sku: s }, warehouse: { code } } });

  return row.quantity - row.reservedQuantity;
};

const demoRows = (referenceType) => prisma.inventoryTransaction.findMany({ where: { referenceType }, orderBy: { id: "asc" } });

describe("demo:prepare", () => {
  it("a dry run shows the plan and writes nothing", async () => {
    await forecastAll();
    const before = await prisma.inventoryTransaction.count();

    const result = await prepare({ apply: false });

    expect(result.applied).toBe(false);
    expect(result.done).toEqual([]);
    expect(result.plans).toHaveLength(DEFAULT_SKUS.length);
    expect(await prisma.inventoryTransaction.count()).toBe(before);
    expect(await demoRows(PREPARE)).toHaveLength(0);
  });

  it("plans a drain that leaves each product 10% below its AI reorder point and makes the replenishment run order it", async () => {
    await forecastAll();

    const { plans } = await prepare({ apply: false });
    const ready = plans.filter((p) => !p.skip);

    expect(ready.length).toBeGreaterThanOrEqual(3);

    for (const p of ready) {
      expect(Math.abs(p.target - p.reorderPoint * 0.9)).toBeLessThan(1.6); // floor of 90% (the printed reorder point is rounded to one decimal)
      expect(p.target).toBeLessThan(p.reorderPoint);
      expect(p.drain).toBe(p.available - p.target);
      expect(p.drain).toBeGreaterThan(0);
      expect(p.suggestedQty).toBeGreaterThan(0);
    }
  });

  it("applies through the inventory service: marked rows, the admin as actor, stock reduced, ledger consistent", async () => {
    await forecastAll();
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { id: "asc" } }); // the one the script picks

    const result = await prepare({ apply: true });

    expect(result.done.length).toBeGreaterThanOrEqual(3);
    const rows = await demoRows(PREPARE);
    expect(rows).toHaveLength(result.done.length);

    for (const done of result.done) {
      const row = rows.find((r) => r.id === done.transactionId);

      expect(row).toMatchObject({ type: "ISSUE", quantity: -done.drain, createdById: admin.id, referenceType: PREPARE });
      expect(row.reason).toMatch(/Demo preparation/);
      expect(await stockOf(done.sku)).toBe(done.target);
    }

    const report = await reconcile(prisma, { scope: "all" });
    expect(report.ok).toBe(true);
    expect(report.errors).toBe(0);
  });

  it("then a replenishment run suggests exactly the prepared products", async () => {
    await forecastAll();
    const { done } = await prepare({ apply: true });
    const before = await prisma.aiSuggestion.count();

    const run = await runReplenishment({ id: 1 });

    const suggested = new Set(run.suggestions.map((s) => s.product.sku));
    expect(before).toBe(0);
    for (const d of done) expect(suggested.has(d.sku)).toBe(true);
    for (const s of run.suggestions.filter((x) => x.warehouse.code === "SYN-MAIN" && done.some((d) => d.sku === x.product.sku))) {
      const plan = done.find((d) => d.sku === s.product.sku);

      expect(s.suggestedQty).toBe(plan.suggestedQty); // the staging computed the same number the run did
      expect(s.available).toBe(plan.target);
    }
  });

  it("will not stage a product twice until it is undone", async () => {
    await forecastAll();
    await prepare({ apply: true });
    const count = await prisma.inventoryTransaction.count({ where: { referenceType: PREPARE } });

    const again = await prepare({ apply: true });

    expect(again.done).toEqual([]);
    expect(again.plans.every((p) => /already prepared/.test(p.skip))).toBe(true);
    expect(await prisma.inventoryTransaction.count({ where: { referenceType: PREPARE } })).toBe(count);
  });

  it("skips what it cannot do and says why: unknown product, no stock record, open orders that cover the need, already below", async () => {
    await forecastAll(["SYN-BRK-001"]);
    const product = await sku("SYN-BRK-001");
    const warehouse = await prisma.warehouse.findFirst({ where: { code: "SYN-MAIN" } });
    const supplier = await prisma.supplier.findFirst({ where: { code: { startsWith: "SYN-" } } });
    // a big open order to the same warehouse covers any need
    await f.createPurchaseOrder({ supplierId: supplier.id, destinationWarehouseId: warehouse.id, items: [{ productId: product.id, quantity: 5000 }] });

    const { plans } = await prepare({ apply: false, skus: ["NOPE-1", "SYN-BRK-001"] });

    expect(plans.find((p) => p.sku === "NOPE-1").skip).toBe("no such product");
    expect(plans.find((p) => p.sku === "SYN-BRK-001").skip).toMatch(/open orders \(\d+ units\) would cover the need/);

    const depot = await prepare({ apply: false, skus: ["SYN-BRK-001"], warehouseCode: "NO-SUCH-WH" });
    expect(depot.plans[0].skip).toBe("no stock record in NO-SUCH-WH");

    await prisma.inventory.update({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } }, data: { quantity: 3 } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { poNumber: { startsWith: "PO-T-" } } } });
    await prisma.purchaseOrder.deleteMany({ where: { poNumber: { startsWith: "PO-T-" } } }); // nothing open any more
    const low = await prepare({ apply: false, skus: ["SYN-BRK-001"] });
    expect(low.plans[0].skip).toBe("already below its reorder point");
  });

  it("aborts without writing anything when the AI service is down", async () => {
    fake.state.down = true;
    const before = await prisma.inventoryTransaction.count();

    await expect(prepare({ apply: true })).rejects.toThrow(/AI service is unavailable/);

    expect(await prisma.inventoryTransaction.count()).toBe(before);
  });

  it("needs an ADMIN user to attribute the rows to, and refuses a remote database", async () => {
    await forecastAll();
    await prisma.user.deleteMany({ where: { role: "ADMIN" } });
    const before = await prisma.inventoryTransaction.count();

    await expect(prepare({ apply: true })).rejects.toThrow(/No active ADMIN user/);
    await expect(prepare({ apply: true, databaseUrl: "postgresql://u:p@db.example.com:5432/app" })).rejects.toThrow(/not local/);
    expect(await prisma.inventoryTransaction.count()).toBe(before);
    // a dry run against a remote database is only reading
    await expect(prepare({ apply: false, databaseUrl: "postgresql://u:p@db.example.com:5432/app" })).resolves.toMatchObject({ applied: false });
  });
});

describe("demo:undo", () => {
  it("a dry run lists what would be put back and writes nothing", async () => {
    await forecastAll();
    const { done } = await prepare({ apply: true });
    const before = await prisma.inventoryTransaction.count();

    const result = await undo({ apply: false });

    expect(result.plans.map((p) => p.sku).sort()).toEqual(done.map((d) => d.sku).sort());
    expect(await prisma.inventoryTransaction.count()).toBe(before);
  });

  it("puts every unit back with new receipt rows that point at the drains, and the ledger stays consistent", async () => {
    await forecastAll();
    const original = Object.fromEntries(await Promise.all(DEFAULT_SKUS.map(async (s) => [s, await stockOf(s)])));
    const { done } = await prepare({ apply: true });

    const result = await undo({ apply: true });

    expect(result.done).toHaveLength(done.length);
    for (const d of done) expect(await stockOf(d.sku)).toBe(original[d.sku]);

    const receipts = await demoRows(UNDO);
    expect(receipts.map((r) => r.referenceId).sort()).toEqual(done.map((d) => d.transactionId).sort());
    expect(receipts.every((r) => r.type === "RECEIPT" && r.quantity > 0)).toBe(true);
    expect((await demoRows(PREPARE)).length).toBe(done.length); // the ledger is append-only: the drains stay
    expect((await reconcile(prisma, { scope: "all" })).ok).toBe(true);
  });

  it("is idempotent, and a prepared product can be prepared again after an undo", async () => {
    await forecastAll();
    await prepare({ apply: true });
    await undo({ apply: true });
    const count = await prisma.inventoryTransaction.count();

    const second = await undo({ apply: true });

    expect(second.plans).toEqual([]);
    expect(second.done).toEqual([]);
    expect(await prisma.inventoryTransaction.count()).toBe(count);

    const again = await prepare({ apply: true });
    expect(again.done.length).toBeGreaterThanOrEqual(3);
  });

  it("does nothing, and says so, when nothing was prepared", async () => {
    const result = await undo({ apply: true });

    expect(result).toMatchObject({ applied: true, plans: [], done: [] });
  });

  it("a later replenishment run drops the suggestions that came from the drained stock", async () => {
    await forecastAll();
    await prepare({ apply: true });
    const first = await runReplenishment({ id: 1 });
    expect(first.suggestions.length).toBeGreaterThanOrEqual(3);

    await undo({ apply: true });
    const second = await runReplenishment({ id: 1 });

    expect(second.suggestions.filter((s) => DEFAULT_SKUS.includes(s.product.sku) && s.warehouse.code === "SYN-MAIN")).toHaveLength(0);
    expect(await prisma.aiSuggestion.count({ where: { status: "PENDING" } })).toBe(second.suggestions.length);
  });
});

describe("with the seed", () => {
  const run = async (args) => {
    const lines = [];
    const code = await seedMain(args, { prisma, log: (line) => lines.push(String(line)) });

    return { code, output: lines.join("\n") };
  };

  it("--replace clears the staging rows with the rest of the seed and ends consistent", async () => {
    await forecastAll();
    await prepare({ apply: true });
    await undo({ apply: true }); // both kinds of row exist
    await prepare({ apply: true });
    expect((await demoRows(PREPARE)).length).toBeGreaterThan(0);

    const { code, output } = await run(["--apply", "--replace"]);

    expect(code).toBe(0);
    expect(output).toMatch(/Result: OK/);
    expect(await demoRows(PREPARE)).toHaveLength(0);
    expect(await demoRows(UNDO)).toHaveLength(0);
    expect(await prisma.inventoryTransaction.count()).toBe(dataset.ledger.length);
  });
});

describe("the command line", () => {
  const cli = async (args) => {
    const lines = [];
    const code = await main(args, (line) => lines.push(String(line)));

    return { code, output: lines.join("\n") };
  };

  it("prints usage for an unknown mode and rejects unknown options", async () => {
    expect((await cli([])).code).toBe(2);
    expect((await cli(["wat"])).code).toBe(2);
    expect(await cli(["prepare", "--bogus"])).toMatchObject({ code: 1, output: expect.stringMatching(/Unknown option --bogus/) });
  });

  it("prepare is a dry run by default and prints a table with the AI reorder point", async () => {
    await forecastAll();

    const dry = await cli(["prepare"]);

    expect(dry.code).toBe(0);
    expect(dry.output).toMatch(/DRY RUN, nothing is written/);
    expect(dry.output).toMatch(/SYN-BRK-001/);
    expect(dry.output).toMatch(/AI reorder pt/);
    expect(dry.output).toMatch(/Add --apply to do it/);
    expect(await demoRows(PREPARE)).toHaveLength(0);
  });

  it("--apply and --sku work together, undo mirrors it, and failures are reported with exit code 1", async () => {
    await forecastAll(["SYN-ENG-004"]);

    const applied = await cli(["prepare", "--apply", "--sku", "SYN-ENG-004"]);
    expect(applied.code).toBe(0);
    expect(applied.output).toMatch(/Drained 1 product/);
    expect(await demoRows(PREPARE)).toHaveLength(1);

    const undone = await cli(["undo", "--apply"]);
    expect(undone.output).toMatch(/Restored 1 movement/);

    fake.state.down = true;
    const down = await cli(["prepare", "--apply"]);
    expect(down.code).toBe(1);
    expect(down.output).toMatch(/Failed: AI service is unavailable/);
  });

  it("prints no secrets", async () => {
    await forecastAll();

    const out = (await cli(["prepare"])).output + (await cli(["undo"])).output;

    expect(out).not.toMatch(/postgres(ql)?:\/\/|password|secret|token/i);
  });
});
