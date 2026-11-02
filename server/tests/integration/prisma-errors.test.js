// Real Prisma errors produced by the real database through @prisma/adapter-pg,
// passed through the real error middleware.
const express = require("express");
const request = require("supertest");

const app = require("../../src/app");
const errorMiddleware = require("../../src/middlewares/error.middleware");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

beforeEach(resetDatabase);
afterAll(disconnect);

const rethrow = (error) => {
  const mini = express();

  mini.get("/boom", async () => {
    throw error;
  });
  mini.use(errorMiddleware);

  return request(mini).get("/boom");
};

describe("real Prisma error shapes", () => {
  it("P2003: a real foreign key violation maps to 409", async () => {
    const warehouse = await f.createWarehouse();

    // Bypass the service (which pre-checks the product) to hit the real FK.
    const error = await prisma.inventory
      .create({ data: { productId: 999999, warehouseId: warehouse.id } })
      .then(
        () => {
          throw new Error("expected a foreign key violation");
        },
        (e) => e
      );

    expect(error.code).toBe("P2003");

    const res = await rethrow(error);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: "Related record conflict" });
  });

  it("P2002: a real duplicate SKU maps to 409 with the specific message", async () => {
    const product = await f.createProduct({ sku: "DUP-1" });

    const res = await request(app)
      .post("/api/v1/products")
      .send({ sku: product.sku, name: "Other", price: 1, unit: "pcs" });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Product SKU already exists");
    expect(await prisma.product.count()).toBe(1);
  });

  it("P2002: a real composite unique violation maps to the generic 409", async () => {
    const s = await f.stockScenario({ quantity: 1 });

    const error = await prisma.inventory
      .create({ data: { productId: s.product.id, warehouseId: s.warehouse.id } })
      .then(
        () => {
          throw new Error("expected a unique violation");
        },
        (e) => e
      );

    const res = await rethrow(error);

    expect(error.code).toBe("P2002");
    expect(res.status).toBe(409);
  });

  it("P2025: a real update of a missing row maps to 404", async () => {
    const res = await request(app).patch("/api/v1/inventory/999999").send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Record not found" });
  });

  it("PrismaClientValidationError: an unknown field maps to 400 without internals", async () => {
    const s = await f.stockScenario({ quantity: 1 });

    const res = await request(app)
      .patch(`/api/v1/inventory/${s.inventory.id}`)
      .send({ notAField: true });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Invalid request data" });
  });
});
