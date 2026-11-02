// The customer and sales-order modules used to decide HTTP status from the error
// message text. They now throw typed AppErrors; these tests pin the mapping.
const app = require("../../src/app");
const { authed } = require("../helpers/http");
const f = require("../helpers/factories");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");

const api = () => authed(app);

beforeEach(resetDatabase);
afterAll(disconnect);

const customerBody = (extra = {}) => ({ customerCode: "CUST-1", name: "Acme Motors", ...extra });

describe("customers", () => {
  it("creates, rejects a duplicate code with 409, and 404s an unknown id", async () => {
    expect((await api().post("/api/v1/customers").send(customerBody())).status).toBe(201);

    const dup = await api().post("/api/v1/customers").send(customerBody());
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe("Customer code already exists");

    expect((await api().get("/api/v1/customers/999999")).status).toBe(404);
  });

  it("400 for a malformed body, a bad id and a bad isActive filter", async () => {
    expect((await api().post("/api/v1/customers").send({ name: "x" })).status).toBe(400);
    expect((await api().get("/api/v1/customers/abc")).status).toBe(400);
    expect((await api().get("/api/v1/customers?isActive=maybe")).status).toBe(400);
  });

  it("404 for an unknown company and 409 for an inactive one", async () => {
    const inactive = await f.createCompany({ isActive: false });

    expect((await api().post("/api/v1/customers").send(customerBody({ companyId: 999999 }))).status).toBe(404);
    expect((await api().post("/api/v1/customers").send(customerBody({ companyId: inactive.id }))).status).toBe(409);
  });
});

describe("sales orders", () => {
  const setup = async (customer = {}) => {
    const c = await prisma.customer.create({ data: { customerCode: `C-${Date.now()}`, name: "Buyer", ...customer } });
    const product = await f.createProduct();

    return { c, product, body: { customerId: c.id, items: [{ productId: product.id, quantity: 2 }] } };
  };

  it("creates an order, then confirms it once; a second confirm is a 409", async () => {
    const { body } = await setup();
    const created = await api().post("/api/v1/sales-orders").send(body);
    expect(created.status).toBe(201);

    const id = created.body.data.id;
    expect((await api().post(`/api/v1/sales-orders/${id}/confirm`)).status).toBe(200);

    const again = await api().post(`/api/v1/sales-orders/${id}/confirm`);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/Only DRAFT/);
  });

  it("404 for an unknown customer, order or product; 409 for an inactive customer", async () => {
    const { body } = await setup();
    const inactive = await setup({ isActive: false });

    expect((await api().post("/api/v1/sales-orders").send({ ...body, customerId: 999999 })).status).toBe(404);
    expect((await api().post("/api/v1/sales-orders").send(inactive.body)).status).toBe(409);
    expect((await api().post("/api/v1/sales-orders").send({ ...body, items: [{ productId: 999999, quantity: 1 }] })).status).toBe(404);
    expect((await api().get("/api/v1/sales-orders/999999")).status).toBe(404);
  });

  it("400 for a duplicate product line, an empty item list and an unknown status filter", async () => {
    const { body, product } = await setup();

    const dup = await api().post("/api/v1/sales-orders").send({ ...body, items: [{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 2 }] });
    expect(dup.status).toBe(400);
    expect((await api().post("/api/v1/sales-orders").send({ ...body, items: [] })).status).toBe(400);
    expect((await api().get("/api/v1/sales-orders?status=NOPE")).status).toBe(400);
  });

  it("409 when cancelling an order that cannot be cancelled", async () => {
    const { body } = await setup();
    const id = (await api().post("/api/v1/sales-orders").send(body)).body.data.id;

    expect((await api().post(`/api/v1/sales-orders/${id}/cancel`)).status).toBe(200);
    expect((await api().post(`/api/v1/sales-orders/${id}/cancel`)).status).toBe(409);
  });
});
