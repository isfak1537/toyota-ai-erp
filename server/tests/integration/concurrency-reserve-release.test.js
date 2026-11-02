const inventoryService = require("../../src/services/inventory.service");
const { ConflictError } = require("../../src/errors/app-error");
const { resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile } = require("../helpers/ledger");
const { settle, times } = require("../helpers/concurrency");

beforeEach(resetDatabase);
afterAll(disconnect);

describe("concurrent reserve (D-02, FR-009)", () => {
  it("10 parallel reservations of 10 on 50 units: exactly 5 succeed, 5 get 409", async () => {
    const s = await f.stockScenario({ quantity: 50 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.reserveStock(args)));

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(5);
    failed.forEach((error) => expect(error).toBeInstanceOf(ConflictError));

    const { inventory, rows } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory).toMatchObject({ quantity: 50, reservedQuantity: 50 });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.type === "RESERVATION" && r.balanceAfter === 50)).toBe(true);
  });

  it("issues and reservations racing on the same stock never exceed what is available", async () => {
    const s = await f.stockScenario({ quantity: 50 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { ok } = await settle([
      ...times(5, () => inventoryService.issueStock(args)),
      ...times(5, () => inventoryService.reserveStock(args)),
    ]);

    expect(ok).toHaveLength(5);

    const { inventory } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory.quantity).toBeGreaterThanOrEqual(inventory.reservedQuantity);
    expect(inventory.quantity - inventory.reservedQuantity).toBe(0);
  });
});

describe("concurrent release (D-02, FR-010)", () => {
  it("10 parallel releases of 10 on 30 reserved: exactly 3 succeed, reserved ends at 0", async () => {
    const s = await f.stockScenario({ quantity: 50, reserved: 30 });
    const args = { productId: s.product.id, warehouseId: s.warehouse.id, quantity: 10 };

    const { ok, failed } = await settle(times(10, () => inventoryService.releaseStock(args)));

    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(7);
    failed.forEach((error) => expect(error).toBeInstanceOf(ConflictError));

    const { inventory, rows } = await reconcile(s.product.id, s.warehouse.id, 50);
    expect(inventory).toMatchObject({ quantity: 50, reservedQuantity: 0 });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.type === "RELEASE" && r.balanceAfter === 50)).toBe(true);
  });
});
