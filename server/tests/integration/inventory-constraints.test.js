const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

// These bypass the service on purpose: the database itself must refuse them.
describe("Inventory CHECK constraints", () => {
  it("rejects negative on-hand quantity", async () => {
    const s = await f.stockScenario({ quantity: 5 });

    await expect(
      prisma.inventory.update({ where: { id: s.inventory.id }, data: { quantity: -1 } })
    ).rejects.toThrow();
  });

  it("rejects negative reserved quantity", async () => {
    const s = await f.stockScenario({ quantity: 5 });

    await expect(
      prisma.inventory.update({ where: { id: s.inventory.id }, data: { reservedQuantity: -1 } })
    ).rejects.toThrow();
  });

  it("rejects reserved quantity above on-hand quantity", async () => {
    const s = await f.stockScenario({ quantity: 5, reserved: 5 });

    await expect(
      prisma.inventory.update({ where: { id: s.inventory.id }, data: { reservedQuantity: 6 } })
    ).rejects.toThrow();
    await expect(
      prisma.inventory.update({ where: { id: s.inventory.id }, data: { quantity: 4 } })
    ).rejects.toThrow();
  });

  it("rejects creating an inventory row that breaks the invariant", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();

    await expect(
      f.createInventory({ productId: product.id, warehouseId: warehouse.id, quantity: 1, reservedQuantity: 2 })
    ).rejects.toThrow();
  });

  it("still allows valid boundary values", async () => {
    const s = await f.stockScenario({ quantity: 5, reserved: 5 });

    const updated = await prisma.inventory.update({
      where: { id: s.inventory.id },
      data: { quantity: 5, reservedQuantity: 0 },
    });

    expect(updated).toMatchObject({ quantity: 5, reservedQuantity: 0 });
  });
});
