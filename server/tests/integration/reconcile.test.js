const { main, reconcile } = require("../../scripts/reconcile");
const { buildDataset } = require("../../prisma/seed/build");
const { writeDataset } = require("../../prisma/seed/writer");
const inventoryService = require("../../src/services/inventory.service");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const dataset = buildDataset();

beforeEach(resetDatabase);
afterAll(disconnect);

const seedDatabase = () => writeDataset(prisma, dataset);

const errorsOf = (report, checkName) => report.results.find((r) => r.name === checkName).errors;
const names = {
  balance: "inventory = last ledger balance",
  chain: "ledger chain is continuous",
  reserved: "0 <= reserved <= on-hand",
  orders: "PO received quantity = goods receipts",
  receipts: "goods receipts <-> ledger",
  transfers: "transfers out = in",
};

describe("reconcile on consistent data", () => {
  it("passes on the seeded dataset with nothing to report (SEED-005)", async () => {
    await seedDatabase();

    for (const scope of ["seed", "all"]) {
      const report = await reconcile(prisma, { scope, strict: true });

      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.results.find((r) => r.name === names.balance).checked).toBe(dataset.inventory.length);
      expect(report.results.find((r) => r.name === names.chain).checked).toBe(dataset.ledger.length);
      expect(report.results.find((r) => r.name === names.transfers).checked).toBe(dataset.transfers.length);
    }
  });

  it("passes on stock moved through the real services", async () => {
    const s = await f.stockScenario({ quantity: 0 });
    const ids = { productId: s.product.id, warehouseId: s.warehouse.id };

    await inventoryService.receiveStock({ ...ids, quantity: 40 });
    await inventoryService.issueStock({ ...ids, quantity: 15 });
    await inventoryService.reserveStock({ ...ids, quantity: 10 });
    await inventoryService.adjustStock({ ...ids, quantity: -5 });
    await inventoryService.releaseStock({ ...ids, quantity: 4 });

    const report = await reconcile(prisma, { scope: "all", strict: true });

    expect(report.ok).toBe(true);
    expect(report.warnings).toBe(0);
  });

  it("works for an empty database", async () => {
    const report = await reconcile(prisma, { scope: "all", strict: true });

    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.checked === 0)).toBe(true);
  });
});

describe("reconcile detects corruption", () => {
  beforeEach(seedDatabase);

  const midIssue = () =>
    prisma.$queryRaw`SELECT id FROM "InventoryTransaction" WHERE type = 'ISSUE' ORDER BY id OFFSET 200 LIMIT 1`.then((r) => r[0].id);

  it("inventory that no longer equals the last ledger balance", async () => {
    await prisma.$executeRaw`UPDATE "Inventory" SET quantity = quantity + 1 WHERE id = (SELECT MIN(id) FROM "Inventory")`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(report.ok).toBe(false);
    expect(errorsOf(report, names.balance)).toHaveLength(1);
    expect(errorsOf(report, names.balance)[0]).toMatch(/inventory \d+ but last ledger balance \d+/);
  });

  it("a ledger row deleted from the middle of a series", async () => {
    const id = await midIssue();
    await prisma.$executeRaw`DELETE FROM "InventoryTransaction" WHERE id = ${id}`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(report.ok).toBe(false);
    expect(errorsOf(report, names.chain).length).toBeGreaterThanOrEqual(1);
    expect(errorsOf(report, names.chain)[0]).toMatch(/balanceAfter \d+, expected \d+/);
  });

  it("a ledger balance that was edited", async () => {
    const id = await midIssue();
    await prisma.$executeRaw`UPDATE "InventoryTransaction" SET "balanceAfter" = "balanceAfter" + 3 WHERE id = ${id}`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(report.ok).toBe(false);
    expect(errorsOf(report, names.chain).some((m) => m.includes(`ledger id ${id}`))).toBe(true);
  });

  it("a negative ledger balance", async () => {
    const id = await midIssue();
    await prisma.$executeRaw`UPDATE "InventoryTransaction" SET "balanceAfter" = -2 WHERE id = ${id}`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(errorsOf(report, names.chain).some((m) => m.includes("negative balance"))).toBe(true);
  });

  it("a purchase order line whose received quantity disagrees with its receipts", async () => {
    await prisma.$executeRaw`UPDATE "PurchaseOrderItem" SET "receivedQuantity" = "receivedQuantity" - 1
                             WHERE id = (SELECT MIN(id) FROM "PurchaseOrderItem" WHERE "receivedQuantity" > 0)`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(report.ok).toBe(false);
    expect(errorsOf(report, names.orders).some((m) => /receivedQuantity \d+ but receipts total \d+/.test(m))).toBe(true);
  });

  it("a purchase order whose status contradicts its quantities", async () => {
    await prisma.$executeRaw`UPDATE "PurchaseOrder" SET status = 'APPROVED'
                             WHERE id = (SELECT MIN(id) FROM "PurchaseOrder" WHERE status = 'RECEIVED')`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(errorsOf(report, names.orders).some((m) => /status APPROVED but quantities say RECEIVED/.test(m))).toBe(true);
  });

  it("a goods receipt whose ledger row is missing or points elsewhere", async () => {
    await prisma.$executeRaw`UPDATE "InventoryTransaction" SET "referenceId" = 999999
                             WHERE id = (SELECT MIN(id) FROM "InventoryTransaction" WHERE "referenceType" = 'GOODS_RECEIPT' AND id > 100)`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(report.ok).toBe(false);
    expect(errorsOf(report, names.receipts).some((m) => /receipt line \d+, ledger 0/.test(m))).toBe(true);
    expect(errorsOf(report, names.receipts).some((m) => /references a goods receipt line that does not exist/.test(m))).toBe(true);
  });

  it("a transfer whose two ledger sides differ", async () => {
    await prisma.$executeRaw`UPDATE "InventoryTransaction" SET quantity = quantity + 1
                             WHERE id = (SELECT MIN(id) FROM "InventoryTransaction" WHERE type = 'TRANSFER_IN')`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(report.ok).toBe(false);
    expect(errorsOf(report, names.transfers).some((m) => /ledger out \d+, in \d+/.test(m))).toBe(true);
  });

  it("an inventory row deleted while the ledger still shows stock", async () => {
    await prisma.$executeRaw`DELETE FROM "Inventory" WHERE id = (SELECT MIN(id) FROM "Inventory" WHERE quantity > 0)`;

    const report = await reconcile(prisma, { scope: "seed" });

    expect(errorsOf(report, names.balance).some((m) => /no inventory row/.test(m))).toBe(true);
  });

  it("but accepts an empty inventory row deleted after its stock reached zero", async () => {
    const s = await f.stockScenario({ quantity: 0 });
    const ids = { productId: s.product.id, warehouseId: s.warehouse.id };
    await inventoryService.receiveStock({ ...ids, quantity: 5 });
    await inventoryService.issueStock({ ...ids, quantity: 5 });
    await prisma.inventory.delete({ where: { id: s.inventory.id } });

    expect((await reconcile(prisma, { scope: "all", strict: true })).ok).toBe(true);
  });

  it("reserved above on-hand is rejected by the database itself", async () => {
    await expect(
      prisma.$executeRaw`UPDATE "Inventory" SET "reservedQuantity" = quantity + 1 WHERE id = (SELECT MIN(id) FROM "Inventory")`
    ).rejects.toThrow();
  });
});

describe("scope, warnings and strict mode", () => {
  it("reports inventory without a ledger as a warning, an error only under --strict", async () => {
    await f.stockScenario({ quantity: 150 }); // like the old seed's SUS-001 row

    const lenient = await reconcile(prisma, { scope: "all" });
    const strict = await reconcile(prisma, { scope: "all", strict: true });

    expect(lenient.ok).toBe(true);
    expect(lenient.warnings).toBe(1);
    expect(lenient.results[0].warnings[0]).toMatch(/no ledger rows at all/);
    expect(strict.ok).toBe(false);
  });

  it("treats a manual series that starts above zero as a warning in scope all and ignores it in scope seed", async () => {
    const s = await f.stockScenario({ quantity: 10 });
    await prisma.inventoryTransaction.create({
      data: { productId: s.product.id, warehouseId: s.warehouse.id, type: "ISSUE", quantity: -3, balanceAfter: 7 },
    });
    await prisma.inventory.update({ where: { id: s.inventory.id }, data: { quantity: 7 } });

    const all = await reconcile(prisma, { scope: "all" });

    expect(all.ok).toBe(true);
    expect(all.warnings).toBe(1);
    expect(all.results[1].warnings[0]).toMatch(/series starts from 10, not 0/);

    await seedDatabase();
    const seed = await reconcile(prisma, { scope: "seed", strict: true });

    expect(seed.ok).toBe(true);
    expect(seed.warnings).toBe(0);
  });

  it("scope seed is not disturbed by broken manual data", async () => {
    await seedDatabase();
    const s = await f.stockScenario({ quantity: 5 });
    await prisma.inventoryTransaction.create({
      data: { productId: s.product.id, warehouseId: s.warehouse.id, type: "RECEIPT", quantity: 5, balanceAfter: 999 },
    });

    expect((await reconcile(prisma, { scope: "seed", strict: true })).ok).toBe(true);
    expect((await reconcile(prisma, { scope: "all" })).ok).toBe(false);
  });

  it("rejects an unknown scope", async () => {
    await expect(reconcile(prisma, { scope: "everything" })).rejects.toThrow(/Unknown scope/);
  });
});

describe("command line", () => {
  const run = async (args) => {
    const lines = [];
    const code = await main(args, { prisma, log: (line) => lines.push(String(line)) });

    return { code, output: lines.join("\n") };
  };

  it("prints a readable table and exits 0 when consistent", async () => {
    await seedDatabase();

    const { code, output } = await run(["--scope", "seed"]);

    expect(code).toBe(0);
    expect(output).toMatch(/Reconcile \(scope: seed\) on database \w+_test/);
    expect(output).toMatch(/inventory = last ledger balance\s+24 checked\s+0 errors/);
    expect(output).toMatch(/Result: OK \(0 errors, 0 warnings\)/);
  });

  it("exits 1 and lists the findings when something is wrong", async () => {
    await seedDatabase();
    await prisma.$executeRaw`UPDATE "Inventory" SET quantity = quantity + 1 WHERE id = (SELECT MIN(id) FROM "Inventory")`;

    const { code, output } = await run(["--scope=seed"]);

    expect(code).toBe(1);
    expect(output).toMatch(/ERROR\s+\[inventory = last ledger balance\]/);
    expect(output).toMatch(/Result: FAILED/);
  });

  it("exits 1 for unknown options and scopes", async () => {
    expect((await run(["--bogus"])).code).toBe(1);
    expect((await run(["--scope", "nope"])).code).toBe(1);
  });

  it("is read-only", async () => {
    await seedDatabase();
    const before = await prisma.inventoryTransaction.count();

    await run(["--strict"]);

    expect(await prisma.inventoryTransaction.count()).toBe(before);
  });
});
