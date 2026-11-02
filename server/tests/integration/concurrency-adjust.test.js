const inventoryService = require("../../src/services/inventory.service");
const { ConflictError } = require("../../src/errors/app-error");
const { resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile } = require("../helpers/ledger");
const { settle, times } = require("../helpers/concurrency");

beforeEach(resetDatabase);
afterAll(disconnect);

describe("concurrent adjust (D-02, FR-008)", () => {
  it("10 parallel adjustments of -10 on 50 units: exactly 5 succeed, stock never goes negative", async () => {
    const s = await f.stockScenario({ quantity: 50 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: -10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.adjustStock(args)));

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(5);
    failed.forEach((error) => {
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.message).toBe("Adjustment would result in negative stock");
    });

    const { inventory, rows } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory.quantity).toBe(0);
    expect(rows.map((r) => r.balanceAfter)).toEqual([40, 30, 20, 10, 0]);
  });

  it("never lets stock drop below the reserved quantity", async () => {
    const s = await f.stockScenario({ quantity: 50, reserved: 30 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: -10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.adjustStock(args)));

    expect(ok).toHaveLength(2);
    expect(failed).toHaveLength(8);
    failed.forEach((error) => {
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.message).toBe("Adjustment would make stock lower than reserved quantity (30)");
    });

    const { inventory } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory).toMatchObject({ quantity: 30, reservedQuantity: 30 });
  });
});
