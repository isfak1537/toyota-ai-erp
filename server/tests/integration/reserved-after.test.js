// The ledger gap from the P0/P1 notes: reserved quantity can now be rebuilt from the ledger.
const { reconcile } = require("../../scripts/reconcile");
const { buildDataset } = require("../../prisma/seed/build");
const { writeDataset } = require("../../prisma/seed/writer");
const inventoryService = require("../../src/services/inventory.service");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

const CHECK = "reserved = last ledger reservedAfter";
const checkOf = (report) => report.results.find((r) => r.name === CHECK);

describe("reservedAfter on new ledger rows", () => {
  it("is written by every stock operation and follows the reserved quantity", async () => {
    const s = await f.stockScenario({ quantity: 0 });
    const ids = { productId: s.product.id, warehouseId: s.warehouse.id };

    await inventoryService.receiveStock({ ...ids, quantity: 40 });
    await inventoryService.reserveStock({ ...ids, quantity: 10 });
    await inventoryService.issueStock({ ...ids, quantity: 5 });
    await inventoryService.reserveStock({ ...ids, quantity: 6 });
    await inventoryService.releaseStock({ ...ids, quantity: 4 });
    await inventoryService.adjustStock({ ...ids, quantity: -3 });

    const rows = await prisma.inventoryTransaction.findMany({ orderBy: { id: "asc" } });

    expect(rows.map((r) => [r.type, r.balanceAfter, r.reservedAfter])).toEqual([
      ["RECEIPT", 40, 0],
      ["RESERVATION", 40, 10],
      ["ISSUE", 35, 10],
      ["RESERVATION", 35, 16],
      ["RELEASE", 35, 12],
      ["ADJUSTMENT", 32, 12],
    ]);
  });

  it("is written for both sides of a transfer and for goods receipts", async () => {
    const source = await f.stockScenario({ quantity: 20, reserved: 5 });
    const destination = await f.createWarehouse();
    // the same product in a second warehouse that already reserves 2
    await prisma.inventory.create({ data: { productId: source.product.id, warehouseId: destination.id, quantity: 3, reservedQuantity: 2 } });

    await require("../../src/services/stock-transfer.service").completeTransfer({
      fromWarehouseId: source.warehouse.id,
      toWarehouseId: destination.id,
      items: [{ productId: source.product.id, quantity: 4 }],
    });

    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: source.product.id }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.type, r.balanceAfter, r.reservedAfter])).toEqual([
      ["TRANSFER_OUT", 16, 5],
      ["TRANSFER_IN", 7, 2],
    ]);
  });

  it("makes reconcile verify the reserved quantity, and catch a drift", async () => {
    const s = await f.stockScenario({ quantity: 0 });
    const ids = { productId: s.product.id, warehouseId: s.warehouse.id };

    await inventoryService.receiveStock({ ...ids, quantity: 30 });
    await inventoryService.reserveStock({ ...ids, quantity: 8 });

    const clean = await reconcile(prisma, { scope: "all", strict: true });
    expect(clean.ok).toBe(true);
    expect(checkOf(clean).checked).toBe(1);

    await prisma.inventory.update({ where: { productId_warehouseId: ids }, data: { reservedQuantity: 3 } });

    const broken = await reconcile(prisma, { scope: "all" });
    expect(broken.ok).toBe(false);
    expect(checkOf(broken).errors).toEqual([expect.stringMatching(/reserved 3 but last ledger reservedAfter 8/)]);
  });

  it("only warns about legacy series that have no reservedAfter at all", async () => {
    const s = await f.stockScenario({ quantity: 5 });
    await prisma.inventoryTransaction.create({
      data: { productId: s.product.id, warehouseId: s.warehouse.id, type: "RECEIPT", quantity: 5, balanceAfter: 5 },
    });

    const report = await reconcile(prisma, { scope: "all" });

    expect(report.ok).toBe(true);
    expect(checkOf(report).checked).toBe(0);
    expect(checkOf(report).warnings).toHaveLength(1);
  });

  it("is verified for the whole seeded dataset", async () => {
    const dataset = buildDataset();
    await writeDataset(prisma, dataset);

    const report = await reconcile(prisma, { scope: "seed", strict: true });

    expect(checkOf(report).checked).toBe(dataset.inventory.length);
    expect(checkOf(report).errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(await prisma.inventoryTransaction.count({ where: { reservedAfter: null } })).toBe(0);
    expect(dataset.ledger.some((r) => r.type === "RESERVATION" && r.reservedAfter > 0)).toBe(true);
  });
});
