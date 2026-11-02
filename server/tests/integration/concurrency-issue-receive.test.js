const inventoryService = require("../../src/services/inventory.service");
const { ConflictError } = require("../../src/errors/app-error");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile } = require("../helpers/ledger");
const { settle, times } = require("../helpers/concurrency");

beforeEach(resetDatabase);
afterAll(disconnect);

describe("concurrent issue (D-02, FR-007)", () => {
  it("10 parallel issues of 10 on 50 units: exactly 5 succeed, 5 get 409, stock ends at 0", async () => {
    const s = await f.stockScenario({ quantity: 50 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.issueStock(args)));

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(5);
    failed.forEach((error) => {
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.statusCode).toBe(409);
    });

    const { inventory, rows } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory).toMatchObject({ quantity: 0, reservedQuantity: 0 });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.type === "ISSUE")).toBe(true);
    expect(rows.map((r) => r.balanceAfter)).toEqual([40, 30, 20, 10, 0]);
  });

  it("never consumes stock reserved for another operation", async () => {
    const s = await f.stockScenario({ quantity: 50, reserved: 20 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.issueStock(args)));

    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(7);

    const { inventory } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory).toMatchObject({ quantity: 20, reservedQuantity: 20 });
  });
});

describe("concurrent receive (D-02, FR-006)", () => {
  it("10 parallel receipts of 10 are all applied (no lost updates)", async () => {
    const s = await f.stockScenario({ quantity: 0 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.receiveStock(args)));

    expect(failed).toHaveLength(0);
    expect(ok).toHaveLength(10);

    const { inventory, rows } = await reconcile(s.product.id, s.warehouse.id, 0);
    expect(inventory.quantity).toBe(100);
    expect(rows.map((r) => r.balanceAfter)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("receipts racing with issues keep the ledger consistent", async () => {
    const s = await f.stockScenario({ quantity: 100 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { failed } = await settle([
      ...times(5, () => inventoryService.receiveStock(args)),
      ...times(5, () => inventoryService.issueStock(args)),
    ]);

    expect(failed).toHaveLength(0);
    const { inventory } = await reconcile(s.product.id, s.warehouse.id, 100);
    expect(inventory.quantity).toBe(100);
    expect(await prisma.inventoryTransaction.count()).toBe(10);
  });
});
