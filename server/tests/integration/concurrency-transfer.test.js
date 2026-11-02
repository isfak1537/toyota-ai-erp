const stockTransferService = require("../../src/services/stock-transfer.service");
const { ConflictError } = require("../../src/errors/app-error");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile } = require("../helpers/ledger");
const { settle, times } = require("../helpers/concurrency");

beforeEach(resetDatabase);
afterAll(disconnect);

const total = async (productId, warehouseIds) => {
  const rows = await prisma.inventory.findMany({
    where: { productId, warehouseId: { in: warehouseIds } },
  });

  return rows.reduce((sum, row) => sum + row.quantity, 0);
};

describe("concurrent transfer (D-02, FR-011)", () => {
  it("10 parallel transfers of 10 from 50 units to an empty warehouse: exactly 5 succeed", async () => {
    const source = await f.stockScenario({ quantity: 50 });
    const destination = await f.createWarehouse();
    const args = {
      fromWarehouseId: source.warehouse.id,
      toWarehouseId: destination.id,
      items: [{ productId: source.product.id, quantity: 10 }],
    };

    const { ok, failed } = await settle(times(10, () => stockTransferService.completeTransfer(args)));

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(5);
    failed.forEach((error) => expect(error).toBeInstanceOf(ConflictError));

    const out = await reconcile(source.product.id, source.warehouse.id, 50);
    expect(out.inventory.quantity).toBe(0);
    expect(out.rows.filter((r) => r.type === "TRANSFER_OUT")).toHaveLength(5);

    // exactly one destination row, created once, with every transfer applied
    expect(await prisma.inventory.count({ where: { warehouseId: destination.id } })).toBe(1);
    const inn = await reconcile(source.product.id, destination.id, 0);
    expect(inn.inventory.quantity).toBe(50);
    expect(inn.rows.filter((r) => r.type === "TRANSFER_IN")).toHaveLength(5);

    // failed transfers rolled back completely
    expect(await prisma.stockTransfer.count()).toBe(5);
    expect(await prisma.inventoryTransaction.count()).toBe(10);
  });

  it("transfers racing with issues never take more than is available", async () => {
    const source = await f.stockScenario({ quantity: 50 });
    const destination = await f.createWarehouse();
    const transfer = {
      fromWarehouseId: source.warehouse.id,
      toWarehouseId: destination.id,
      items: [{ productId: source.product.id, quantity: 10 }],
    };
    const inventoryService = require("../../src/services/inventory.service");

    const { ok } = await settle([
      ...times(5, () => stockTransferService.completeTransfer(transfer)),
      ...times(5, () =>
        inventoryService.issueStock({
          productId: source.product.id,
          warehouseId: source.warehouse.id,
          quantity: 10,
        })
      ),
    ]);

    expect(ok).toHaveLength(5);
    const out = await reconcile(source.product.id, source.warehouse.id, 50);
    expect(out.inventory.quantity).toBe(0);
  });

  it("crossing transfers A<->B on several products neither deadlock nor lose stock", async () => {
    const a = await f.stockScenario({ quantity: 100 });
    const b = await f.createWarehouse();
    const p2 = await f.createProduct();
    await f.createInventory({ productId: p2.id, warehouseId: a.warehouse.id, quantity: 100 });
    await f.createInventory({ productId: a.product.id, warehouseId: b.id, quantity: 100 });
    await f.createInventory({ productId: p2.id, warehouseId: b.id, quantity: 100 });

    const p1Id = a.product.id;
    const forward = {
      fromWarehouseId: a.warehouse.id,
      toWarehouseId: b.id,
      items: [
        { productId: p1Id, quantity: 5 },
        { productId: p2.id, quantity: 5 },
      ],
    };
    const backward = {
      fromWarehouseId: b.id,
      toWarehouseId: a.warehouse.id,
      items: [
        { productId: p2.id, quantity: 5 },
        { productId: p1Id, quantity: 5 },
      ],
    };

    const { ok, failed } = await settle([
      ...times(5, () => stockTransferService.completeTransfer(forward)),
      ...times(5, () => stockTransferService.completeTransfer(backward)),
    ]);

    expect(failed).toHaveLength(0);
    expect(ok).toHaveLength(10);
    expect(await total(p1Id, [a.warehouse.id, b.id])).toBe(200);
    expect(await total(p2.id, [a.warehouse.id, b.id])).toBe(200);
    await reconcile(p1Id, a.warehouse.id, 100);
    await reconcile(p1Id, b.id, 100);
  });
});
