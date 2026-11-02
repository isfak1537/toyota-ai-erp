const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

describe("factories", () => {
  it("builds a warehouse with its factory and company chain", async () => {
    const warehouse = await f.createWarehouse();
    const row = await prisma.warehouse.findUnique({
      where: { id: warehouse.id },
      include: { factory: { include: { company: true } } },
    });

    expect(row.factory.company.id).toBeGreaterThan(0);
  });

  it("builds unique products and warehouses on repeated calls", async () => {
    await f.createProduct();
    await f.createProduct();
    await f.createWarehouse();
    await f.createWarehouse();

    expect(await prisma.product.count()).toBe(2);
    expect(await prisma.warehouse.count()).toBe(2);
  });

  it("builds a stock scenario", async () => {
    const { inventory } = await f.stockScenario({ quantity: 50, reserved: 20 });

    expect(inventory.quantity).toBe(50);
    expect(inventory.reservedQuantity).toBe(20);
  });

  it("builds a purchase order with items and a requisition with items", async () => {
    const product = await f.createProduct();
    const requisition = await f.createRequisition({
      status: "APPROVED",
      items: [{ productId: product.id, quantity: 5 }],
    });
    const po = await f.createPurchaseOrder({
      requisitionId: requisition.id,
      items: [{ productId: product.id, quantity: 5 }],
    });

    expect(requisition.items).toHaveLength(1);
    expect(po.items).toHaveLength(1);
    expect(po.status).toBe("APPROVED");
  });
});
