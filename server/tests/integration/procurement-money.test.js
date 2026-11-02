const { Prisma } = require("@prisma/client");

const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

const api = () => authed(app);
const dec = (value) => new Prisma.Decimal(value);

beforeEach(resetDatabase);
afterAll(disconnect);

describe("procurement money uses decimal arithmetic (D-06)", () => {
  it("PO totals are exact: 3 x 0.10 + 1 x 0.20 + tax 0.07", async () => {
    const a = await f.createProduct();
    const b = await f.createProduct();
    const supplier = await f.createSupplier();

    const res = await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        taxAmount: 0.07,
        items: [
          { productId: a.id, quantity: 3, unitPrice: 0.1 },
          { productId: b.id, quantity: 1, unitPrice: 0.2 },
        ],
      });

    expect(res.status).toBe(201);
    expect(dec(res.body.data.subtotal).equals("0.5")).toBe(true);
    expect(dec(res.body.data.taxAmount).equals("0.07")).toBe(true);
    expect(dec(res.body.data.totalAmount).equals("0.57")).toBe(true);
    const lineTotals = res.body.data.items.map((i) => dec(i.lineTotal).toString()).sort();
    expect(lineTotals).toEqual(["0.2", "0.3"]);
  });

  it("rounds amounts with more than 2 decimals half-up (1.005 -> 1.01)", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();

    const res = await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 1, unitPrice: 1.005 }],
      });

    expect(res.status).toBe(201);
    expect(dec(res.body.data.items[0].unitPrice).equals("1.01")).toBe(true);
    expect(dec(res.body.data.totalAmount).equals("1.01")).toBe(true);
  });

  it("rounds requisition estimated prices half-up (2.675 -> 2.68)", async () => {
    const product = await f.createProduct();

    const res = await api()
      .post("/api/v1/procurement/requisitions")
      .send({
        requesterName: "Tester",
        items: [{ productId: product.id, quantity: 1, estimatedUnitPrice: 2.675 }],
      });

    expect(res.status).toBe(201);
    expect(dec(res.body.data.items[0].estimatedUnitPrice).equals("2.68")).toBe(true);
  });

  it("invoice paid exactly equal to the total (0.1 + 0.2 = 0.3) is PAID", async () => {
    const a = await f.createProduct();
    const b = await f.createProduct();
    const supplier = await f.createSupplier();
    const items = [
      { productId: a.id, quantity: 1, unitPrice: 0.1 },
      { productId: b.id, quantity: 1, unitPrice: 0.2 },
    ];

    const paid = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({ invoiceNumber: "INV-PAID", supplierId: supplier.id, paidAmount: 0.3, items });

    expect(paid.status).toBe(201);
    expect(paid.body.data.status).toBe("PAID");
    expect(dec(paid.body.data.totalAmount).equals("0.3")).toBe(true);

    const partial = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({ invoiceNumber: "INV-PART", supplierId: supplier.id, paidAmount: 0.1, items });

    expect(partial.status).toBe(201);
    expect(partial.body.data.status).toBe("PARTIALLY_PAID");

    const unpaid = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({ invoiceNumber: "INV-UNPAID", supplierId: supplier.id, items });

    expect(unpaid.body.data.status).toBe("UNPAID");
  });

  it("rejects an overpaid invoice by one cent and accepts the exact total", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();
    const base = {
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 3, unitPrice: 19.99 }],
    };

    const over = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({ ...base, invoiceNumber: "INV-OVER", paidAmount: 59.98 });

    expect(over.status).toBe(400);

    const exact = await api()
      .post("/api/v1/procurement/purchase-invoices")
      .send({ ...base, invoiceNumber: "INV-EXACT", paidAmount: 59.97 });

    expect(exact.status).toBe(201);
    expect(exact.body.data.status).toBe("PAID");
    expect(await prisma.purchaseInvoice.count()).toBe(1);
  });

  it("stores large amounts without float drift", async () => {
    const product = await f.createProduct();
    const supplier = await f.createSupplier();

    const res = await api()
      .post("/api/v1/procurement/purchase-orders")
      .send({
        supplierId: supplier.id,
        taxAmount: 0.01,
        items: [{ productId: product.id, quantity: 1000, unitPrice: 9999999.99 }],
      });

    expect(res.status).toBe(201);
    expect(dec(res.body.data.subtotal).equals("9999999990")).toBe(true);
    expect(dec(res.body.data.totalAmount).equals("9999999990.01")).toBe(true);
  });
});
