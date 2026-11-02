const request = require("supertest");

const app = require("../../src/app");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

describe("values that fit the input bounds but overflow the column types", () => {
  it("receiving stock past the Int range is a 400, not a 500, and changes nothing", async () => {
    const s = await f.stockScenario({ quantity: 2_100_000_000 });

    const res = await request(app)
      .post("/api/v1/inventory/receive")
      .send({ productId: s.product.id, warehouseId: s.warehouse.id, quantity: 100_000_000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "A numeric value is outside the allowed range",
    });
    expect((await prisma.inventory.findUnique({ where: { id: s.inventory.id } })).quantity).toBe(2_100_000_000);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it("a PO line total beyond Decimal(14,2) is a 400, not a 500", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();

    const res = await request(app)
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 100_000_000, unitPrice: 9_999_999_999.99 }],
      });

    expect(res.status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });
});
