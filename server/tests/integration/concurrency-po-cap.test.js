const request = require("supertest");

const app = require("../../src/app");
const procurementService = require("../../src/services/procurement.service");
const { ConflictError, ValidationError } = require("../../src/errors/app-error");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { settle, times } = require("../helpers/concurrency");

beforeEach(resetDatabase);
afterAll(disconnect);

// A supplier, one product and an APPROVED requisition for `quantity` units.
const setup = async (quantity = 10) => {
  const supplier = await f.createSupplier();
  const product = await f.createProduct();
  const requisition = await f.createRequisition({
    status: "APPROVED",
    items: [{ productId: product.id, quantity }],
  });

  const order = (qty) =>
    procurementService.createPurchaseOrder({
      supplierId: supplier.id,
      requisitionId: requisition.id,
      items: [{ productId: product.id, quantity: qty, unitPrice: 5 }],
    });

  return { supplier, product, requisition, order };
};

const committed = async (requisitionId) => {
  const rows = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrder: { requisitionId, status: { not: "CANCELLED" } } },
  });

  return rows.reduce((sum, row) => sum + row.quantity, 0);
};

describe("cumulative requisition cap on purchase orders (FR-014)", () => {
  it("two POs of 6 racing on a requisition line of 10: exactly one succeeds", async () => {
    const { requisition, order } = await setup(10);

    const { ok, failed } = await settle([order(6), order(6)]);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toBeInstanceOf(ConflictError);
    expect(failed[0].message).toMatch(/remaining requisition quantity.*4/);
    expect(await committed(requisition.id)).toBe(6);
    expect(await prisma.purchaseOrder.count()).toBe(1);
  });

  it("12 parallel POs of 1 on a line of 10: exactly 10 succeed", async () => {
    const { requisition, order } = await setup(10);

    const { ok, failed } = await settle(times(12, () => order(1)));

    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(2);
    failed.forEach((error) => expect(error).toBeInstanceOf(ConflictError));
    expect(await committed(requisition.id)).toBe(10);
  });

  it("sequential POs add up: 6 then 4 succeed, one more unit is a 409", async () => {
    const { requisition, order } = await setup(10);

    await order(6);
    await order(4);

    await expect(order(1)).rejects.toBeInstanceOf(ConflictError);
    expect(await committed(requisition.id)).toBe(10);
  });

  it("a cancelled PO releases its quantity", async () => {
    const { supplier, product, requisition, order } = await setup(10);
    await f.createPurchaseOrder({
      status: "CANCELLED",
      supplierId: supplier.id,
      requisitionId: requisition.id,
      items: [{ productId: product.id, quantity: 8 }],
    });

    await expect(order(10)).resolves.toMatchObject({ status: "PENDING_APPROVAL" });
  });

  it("caps each requisition line separately", async () => {
    const supplier = await f.createSupplier();
    const a = await f.createProduct();
    const b = await f.createProduct();
    const requisition = await f.createRequisition({
      status: "APPROVED",
      items: [
        { productId: a.id, quantity: 5 },
        { productId: b.id, quantity: 5 },
      ],
    });
    const order = (items) =>
      procurementService.createPurchaseOrder({
        supplierId: supplier.id,
        requisitionId: requisition.id,
        items: items.map(([productId, quantity]) => ({ productId, quantity, unitPrice: 1 })),
      });

    await order([[a.id, 5]]);
    await expect(order([[a.id, 1]])).rejects.toBeInstanceOf(ConflictError);
    await expect(order([[b.id, 5]])).resolves.toBeDefined();
  });

  it("a single PO above the requisition quantity stays a 400 (static rule)", async () => {
    const { order } = await setup(10);

    await expect(order(11)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a rejected PO leaves nothing behind", async () => {
    const { requisition, order } = await setup(10);
    await order(10);

    const res = await request(app)
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: (await prisma.purchaseOrder.findFirst()).supplierId,
        requisitionId: requisition.id,
        items: [{ productId: (await prisma.purchaseOrderItem.findFirst()).productId, quantity: 1, unitPrice: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/remaining requisition quantity/);
    expect(await prisma.purchaseOrder.count()).toBe(1);
  });

  it("POs without a requisition are unaffected", async () => {
    const supplier = await f.createSupplier();
    const product = await f.createProduct();
    const make = () =>
      procurementService.createPurchaseOrder({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 1000, unitPrice: 1 }],
      });

    const { ok, failed } = await settle(times(5, make));

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(0);
  });
});
