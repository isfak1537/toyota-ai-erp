const { main } = require("../../prisma/seed/generate");
const { buildDataset } = require("../../prisma/seed/build");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const run = async (args, extra = {}) => {
  const lines = [];
  const code = await main(args, { prisma, log: (line) => lines.push(String(line)), ...extra });

  return { code, output: lines.join("\n") };
};

const counts = async () => ({
  product: await prisma.product.count(),
  inventory: await prisma.inventory.count(),
  ledger: await prisma.inventoryTransaction.count(),
  orders: await prisma.purchaseOrder.count(),
  receipts: await prisma.goodsReceipt.count(),
  transfers: await prisma.stockTransfer.count(),
  company: await prisma.company.count(),
});

// Everything in the database that matters, without auto-increment ids, so two
// runs can be compared for identical content (SEED-006).
const snapshot = async () => {
  const q = async (strings, ...values) =>
    JSON.stringify(await prisma.$queryRaw(strings, ...values), (k, v) => (typeof v === "bigint" ? Number(v) : v));

  return [
    await q`SELECT p.sku, w.code AS wh, t.type, t.quantity, t."balanceAfter", t."createdAt", t."referenceType", t.reason,
                   COALESCE(g."receiptNumber", s."transferNumber") AS ref
            FROM "InventoryTransaction" t
            JOIN "Product" p ON p.id = t."productId"
            JOIN "Warehouse" w ON w.id = t."warehouseId"
            LEFT JOIN "GoodsReceipt" g ON t."referenceType" = 'GOODS_RECEIPT' AND g.id = t."referenceId"
            LEFT JOIN "StockTransfer" s ON t."referenceType" = 'STOCK_TRANSFER' AND s.id = t."referenceId"
            WHERE p.sku LIKE 'SYN-%' ORDER BY t."createdAt", t.id`,
    await q`SELECT p.sku, w.code AS wh, i.quantity, i."reservedQuantity", i."createdAt", i."updatedAt"
            FROM "Inventory" i JOIN "Product" p ON p.id = i."productId" JOIN "Warehouse" w ON w.id = i."warehouseId"
            WHERE p.sku LIKE 'SYN-%' ORDER BY p.sku, w.code`,
    await q`SELECT po."poNumber", s.code AS supplier, po.status, po."orderDate", po.subtotal, po."taxAmount", po."totalAmount",
                   p.sku, i.quantity, i."receivedQuantity", i."unitPrice", i."lineTotal"
            FROM "PurchaseOrder" po JOIN "Supplier" s ON s.id = po."supplierId"
            JOIN "PurchaseOrderItem" i ON i."purchaseOrderId" = po.id JOIN "Product" p ON p.id = i."productId"
            WHERE s.code LIKE 'SYN-%' ORDER BY po."poNumber"`,
    await q`SELECT sp."supplierSku", sp."unitPrice", sp."leadTimeDays", sp."minimumOrderQty", sp."isPreferred"
            FROM "SupplierProduct" sp JOIN "Product" p ON p.id = sp."productId" WHERE p.sku LIKE 'SYN-%' ORDER BY sp."supplierSku"`,
  ].join("\n");
};

const manualFootprint = async () =>
  JSON.stringify({
    products: await prisma.product.findMany({ where: { sku: { not: { startsWith: "SYN-" } } }, orderBy: { id: "asc" } }),
    inventory: await prisma.inventory.findMany({ where: { product: { sku: { not: { startsWith: "SYN-" } } } }, orderBy: { id: "asc" } }),
    ledger: await prisma.inventoryTransaction.findMany({ where: { product: { sku: { not: { startsWith: "SYN-" } } } }, orderBy: { id: "asc" } }),
    companies: await prisma.company.findMany({ where: { code: { not: "SYN-DEMO" } }, orderBy: { id: "asc" } }),
    factories: await prisma.factory.findMany({ where: { code: { not: "SYN-DHAKA" } }, orderBy: { id: "asc" } }),
    warehouses: await prisma.warehouse.findMany({ where: { code: { not: { startsWith: "SYN-" } } }, orderBy: { id: "asc" } }),
    suppliers: await prisma.supplier.findMany({ where: { code: { not: { startsWith: "SYN-" } } }, orderBy: { id: "asc" } }),
    categories: await prisma.category.findMany({ where: { name: { not: { startsWith: "[SYN] " } } }, orderBy: { id: "asc" } }),
  });

beforeEach(resetDatabase);
afterAll(disconnect);

describe("dry run (default)", () => {
  it("writes nothing and says so", async () => {
    const { code, output } = await run([]);

    expect(code).toBe(0);
    expect(output).toMatch(/DRY RUN/);
    expect(output).toMatch(/Add --apply to write/);
    expect(await counts()).toEqual({ product: 0, inventory: 0, ledger: 0, orders: 0, receipts: 0, transfers: 0, company: 0 });
  });

  it("names the target database but never prints the connection string", async () => {
    const { output } = await run([], { databaseUrl: "postgresql://someuser:s3cretpw@localhost:5432/toyota_erp_test" });

    expect(output).toMatch(/Target database: toyota_erp_test on localhost/);
    expect(output).not.toMatch(/s3cretpw|someuser|postgresql:\/\//);
  });
});

describe("--apply writes the dataset", () => {
  it("creates every record of the in-memory dataset (SEED-001..003)", async () => {
    const dataset = buildDataset();
    const { code } = await run(["--apply"]);

    expect(code).toBe(0);
    expect(await counts()).toEqual({
      product: dataset.products.length,
      inventory: dataset.inventory.length,
      ledger: dataset.ledger.length,
      orders: dataset.purchaseOrders.length,
      receipts: dataset.goodsReceipts.length,
      transfers: dataset.transfers.length,
      company: 1,
    });
    expect(await prisma.warehouse.count()).toBe(2);
    expect(await prisma.supplier.count()).toBe(5);
    expect(await prisma.category.count()).toBe(3);
    expect((await prisma.company.findFirst()).name).toMatch(/Synthetic Demo/);
  });

  it("stores back-dated, chronologically ordered ledger rows (SEED-005)", async () => {
    await run(["--apply"]);

    const rows = await prisma.inventoryTransaction.findMany({ orderBy: { id: "asc" }, select: { createdAt: true } });

    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].createdAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1].createdAt.getTime());
    }

    expect(rows[0].createdAt.toISOString().slice(0, 10)).toBe("2026-08-04");
    expect(rows[rows.length - 1].createdAt.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("leaves every inventory row equal to its last ledger balance and inside the CHECK constraints", async () => {
    await run(["--apply"]);

    const mismatches = await prisma.$queryRaw`
      SELECT i.id FROM "Inventory" i
      WHERE i."quantity" IS DISTINCT FROM (
        SELECT t."balanceAfter" FROM "InventoryTransaction" t
        WHERE t."productId" = i."productId" AND t."warehouseId" = i."warehouseId"
        ORDER BY t."createdAt" DESC, t.id DESC LIMIT 1)
      OR i."reservedQuantity" > i."quantity" OR i."reservedQuantity" < 0 OR i."quantity" < 0`;

    expect(mismatches).toHaveLength(0);
  });

  it("links ledger rows to their goods receipts and transfers", async () => {
    await run(["--apply"]);

    const orphans = await prisma.$queryRaw`
      SELECT t.id FROM "InventoryTransaction" t
      WHERE (t."referenceType" = 'GOODS_RECEIPT' AND NOT EXISTS (SELECT 1 FROM "GoodsReceipt" g WHERE g.id = t."referenceId"))
         OR (t."referenceType" = 'STOCK_TRANSFER' AND NOT EXISTS (SELECT 1 FROM "StockTransfer" s WHERE s.id = t."referenceId"))`;

    expect(orphans).toHaveLength(0);
  });

  it("marks every seeded master record with the SYN- prefix", async () => {
    await run(["--apply"]);

    expect(await prisma.product.count({ where: { sku: { not: { startsWith: "SYN-" } } } })).toBe(0);
    expect(await prisma.supplier.count({ where: { code: { not: { startsWith: "SYN-" } } } })).toBe(0);
    expect(await prisma.category.count({ where: { name: { not: { startsWith: "[SYN] " } } } })).toBe(0);
    expect(await prisma.warehouse.count({ where: { code: { not: { startsWith: "SYN-" } } } })).toBe(0);
  });
});

describe("re-running is safe", () => {
  it("refuses a second --apply without --replace and changes nothing", async () => {
    await run(["--apply"]);
    const before = await snapshot();

    const { code, output } = await run(["--apply"]);

    expect(code).toBe(2);
    expect(output).toMatch(/Refusing to write: seed-owned rows already exist/);
    expect(output).toMatch(/inventoryTransaction/);
    expect(await snapshot()).toBe(before);
  });

  it("--apply --replace twice yields identical content (SEED-006)", async () => {
    await run(["--apply"]);
    const first = await snapshot();

    const second = await run(["--apply", "--replace"]);
    expect(second.code).toBe(0);
    expect(second.output).toMatch(/Deleted seed-owned rows/);

    expect(await snapshot()).toBe(first);
  });

  it("a different seed replaces the data with different, still consistent data", async () => {
    await run(["--apply"]);
    const first = await snapshot();

    expect((await run(["--apply", "--replace", "--seed", "7"])).code).toBe(0);

    expect(await snapshot()).not.toBe(first);
    expect(await prisma.inventoryTransaction.count()).toBe(buildDataset({ seed: 7 }).ledger.length);
  });

  it("--replace deletes only seed-owned rows and leaves manual data byte-for-byte alone", async () => {
    // manual rows: some with dependents (product + stock), some without any
    // (supplier, category, spare warehouse), so a too-broad delete cannot hide
    // behind a foreign-key rollback
    const manual = await f.stockScenario({ quantity: 150, reserved: 20, product: { sku: "SUS-001", name: "Brake Pad Set" } });
    await prisma.inventoryTransaction.create({
      data: { productId: manual.product.id, warehouseId: manual.warehouse.id, type: "RECEIPT", quantity: 150, balanceAfter: 150 },
    });
    await f.createSupplier({ code: "SUP-001", name: "ABC Auto Parts Ltd" });
    await f.createCategory({ name: "Brake & Suspension" });
    await f.createWarehouse();
    const before = await manualFootprint();

    expect(JSON.parse(before).suppliers).toHaveLength(1);
    expect(JSON.parse(before).categories).toHaveLength(1);

    expect((await run(["--apply"])).code).toBe(0);
    expect(await manualFootprint()).toBe(before);

    const seeded = await snapshot();

    for (let i = 0; i < 2; i += 1) {
      const replaced = await run(["--apply", "--replace"]);

      expect(replaced.code).toBe(0);
      expect(replaced.output).toMatch(/Deleted seed-owned rows/);
      expect(await manualFootprint()).toBe(before);
      expect(await snapshot()).toBe(seeded);
    }

    expect(await prisma.product.count({ where: { sku: "SUS-001" } })).toBe(1);
    expect(await prisma.supplier.count({ where: { code: "SUP-001" } })).toBe(1);
  });

  it("refuses to replace while manual rows reference seed data, and deletes nothing", async () => {
    await run(["--apply"]);
    const seedProduct = await prisma.product.findFirst({ where: { sku: "SYN-BRK-001" } });
    const manualWarehouse = await f.createWarehouse();
    await f.createInventory({ productId: seedProduct.id, warehouseId: manualWarehouse.id, quantity: 5 });
    const before = await snapshot();

    const { code, output } = await run(["--apply", "--replace"]);

    expect(code).toBe(2);
    expect(output).toMatch(/stock of SYN- products outside the SYN- warehouses/);
    expect(output).toMatch(/Refusing to replace/);
    expect(await snapshot()).toBe(before);
    expect(await prisma.inventory.count({ where: { warehouseId: manualWarehouse.id } })).toBe(1);
  });

  it("a dry run with --replace only reports what would be deleted", async () => {
    await run(["--apply"]);
    const before = await snapshot();

    const { code, output } = await run(["--replace"]);

    expect(code).toBe(0);
    expect(output).toMatch(/Seed-owned rows already in this database: [1-9]/);
    expect(await snapshot()).toBe(before);
  });
});

describe("guards", () => {
  it("refuses to write to a non-local host unless --allow-remote is given", async () => {
    const { code, output } = await run(["--apply"], { databaseUrl: "postgresql://u:p@db.example.com:5432/prod" });

    expect(code).toBe(2);
    expect(output).toMatch(/host is not local/);
    expect(output).not.toMatch(/postgresql:\/\/|:p@/);
    expect(await counts()).toMatchObject({ product: 0, ledger: 0 });
  });

  it("refuses when the host cannot be determined", async () => {
    expect((await run(["--apply"], { databaseUrl: "" })).code).toBe(2);
    expect((await run(["--apply"], { databaseUrl: "not a url" })).code).toBe(2);
    expect(await counts()).toMatchObject({ product: 0 });
  });

  it("rejects unknown options and bad values without touching the database", async () => {
    for (const args of [["--wipe"], ["--seed", "abc"], ["--seed"], ["--end-date", "2026-13-40"], ["--end-date=yesterday"]]) {
      const { code } = await run(args);

      expect(code).toBe(1);
    }

    expect(await counts()).toMatchObject({ product: 0 });
  });

  it("prints usage for --help", async () => {
    const { code, output } = await run(["--help"]);

    expect(code).toBe(0);
    expect(output).toMatch(/Usage: npm run seed:synthetic/);
  });
});
