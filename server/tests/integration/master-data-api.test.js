// Direct API tests for the master-data maintenance requirements:
//   FR-001 organization (companies, factories, warehouses), FR-002 product, FR-003 supplier, FR-004 supplier-product.
// Each resource: create, read, update, deactivate, invalid input, duplicate, unknown id, 401 and 403.
const request = require("supertest");

const app = require("../../src/app");
const f = require("../helpers/factories");
const { authed } = require("../helpers/http");
const { createUser, bearer } = require("../helpers/auth");
const { resetDatabase, disconnect } = require("../helpers/db");

beforeEach(resetDatabase);
afterAll(disconnect);

const api = () => authed(app); // the baseline ADMIN
const as = async (role) => authed(app, (await createUser(role)).token);

const MASTER_DATA_WRITERS = ["ADMIN"]; // companies, factories, warehouses, products
const PROCUREMENT_WRITERS = ["ADMIN", "PROCUREMENT_OFFICER"]; // suppliers, supplier-products
const ALL_ROLES = ["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER", "VIEWER"];

// 401 for no/invalid token, 403 for a role that may not write, reads open to every role.
const accessTests = ({ path, writers, makeBody, makeExisting }) => {
  const denied = ALL_ROLES.filter((role) => !writers.includes(role));

  it("401 without a token, with a malformed token and with a token signed by another secret", async () => {
    const forged = require("jsonwebtoken").sign({ role: "ADMIN" }, "x".repeat(40), { subject: "1" });

    for (const header of [undefined, "Bearer not-a-token", bearer(forged)]) {
      const get = request(app).get(path);
      const post = request(app).post(path).send(await makeBody());

      if (header) {
        get.set("Authorization", header);
        post.set("Authorization", header);
      }

      expect((await get).status).toBe(401);
      expect((await post).status).toBe(401);
    }
  });

  it.each(denied)("403 for %s on create, update and deactivate, and nothing changes", async (role) => {
    const agent = await as(role);
    const existing = await makeExisting();

    expect((await agent.post(path).send(await makeBody())).status).toBe(403);
    expect((await agent.patch(`${path}/${existing.id}`).send({ isActive: false })).status).toBe(403);

    const del = await agent.delete(`${path}/${existing.id}`);
    if (!(path.includes("supplier-products") && del.status === 404)) expect(del.status).toBe(403);

    const after = await api().get(`${path}/${existing.id}`);
    expect(after.body.data.isActive ?? true).toBe(true);
  });

  it.each(ALL_ROLES)("%s can read the list and one record", async (role) => {
    const agent = await as(role);
    const existing = await makeExisting();

    expect((await agent.get(path)).status).toBe(200);
    expect((await agent.get(`${path}/${existing.id}`)).status).toBe(200);
  });
};

describe("FR-001 companies", () => {
  const path = "/api/v1/companies";
  const body = (extra = {}) => ({ name: "Toyota Test Co", code: `CO-${Math.random().toString(36).slice(2, 8)}`, currencyCode: "BDT", ...extra });

  it("creates, reads, lists, updates and deactivates a company", async () => {
    const created = await api().post(path).send(body({ code: "CO-1" }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ success: true, data: { code: "CO-1", isActive: true } });

    const id = created.body.data.id;
    expect((await api().get(`${path}/${id}`)).body.data.name).toBe("Toyota Test Co");
    expect((await api().get(path)).body.data.map((c) => c.id)).toContain(id);

    const updated = await api().patch(`${path}/${id}`).send({ name: "Renamed", country: "BD" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: "Renamed", country: "BD", code: "CO-1" });

    expect((await api().delete(`${path}/${id}`)).status).toBe(200);
    expect((await api().get(`${path}/${id}`)).body.data.isActive).toBe(false);
  });

  it("400 for a missing name, an empty code and a currency code that is not 3 letters", async () => {
    for (const bad of [{ name: undefined }, { code: "  " }, { currencyCode: "TAKA" }, { isActive: "yes" }]) {
      const res = await api().post(path).send(body(bad));
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it("409 for a duplicate code on create and on update", async () => {
    await api().post(path).send(body({ code: "DUP" }));
    expect((await api().post(path).send(body({ code: "DUP" }))).status).toBe(409);

    const other = (await api().post(path).send(body({ code: "OTHER" }))).body.data;
    expect((await api().patch(`${path}/${other.id}`).send({ code: "DUP" })).status).toBe(409);
  });

  it("404 for an unknown id on read, update and deactivate", async () => {
    expect((await api().get(`${path}/999999`)).status).toBe(404);
    expect((await api().patch(`${path}/999999`).send({ name: "x" })).status).toBe(404);
    expect((await api().delete(`${path}/999999`)).status).toBe(404);
  });

  accessTests({ path, writers: MASTER_DATA_WRITERS, makeBody: async () => body(), makeExisting: () => f.createCompany() });
});

describe("FR-001 factories", () => {
  const path = "/api/v1/factories";
  const body = async (extra = {}) => ({ name: "Plant A", code: `FA-${Math.random().toString(36).slice(2, 8)}`, companyId: (await f.createCompany()).id, ...extra });

  it("creates, reads, updates and deactivates a factory", async () => {
    const created = await api().post(path).send(await body({ code: "FA-1" }));
    expect(created.status).toBe(201);

    const id = created.body.data.id;
    expect((await api().get(`${path}/${id}`)).body.data.code).toBe("FA-1");
    expect((await api().patch(`${path}/${id}`).send({ address: "Gazipur" })).body.data.address).toBe("Gazipur");
    expect((await api().delete(`${path}/${id}`)).status).toBe(200);
    expect((await api().get(`${path}/${id}`)).body.data.isActive).toBe(false);
  });

  it("400 for a missing company and a non-positive company id", async () => {
    expect((await api().post(path).send(await body({ companyId: undefined }))).status).toBe(400);
    expect((await api().post(path).send(await body({ companyId: 0 }))).status).toBe(400);
  });

  it("404 for an unknown company and an unknown factory", async () => {
    expect((await api().post(path).send(await body({ companyId: 999999 }))).status).toBe(404);
    expect((await api().get(`${path}/999999`)).status).toBe(404);
  });

  it("409 for a duplicate code within the same company, 201 in another company", async () => {
    const { companyId } = await body();
    await api().post(path).send(await body({ code: "DUP", companyId }));

    expect((await api().post(path).send(await body({ code: "DUP", companyId }))).status).toBe(409);
    expect((await api().post(path).send(await body({ code: "DUP" }))).status).toBe(201);
  });

  accessTests({ path, writers: MASTER_DATA_WRITERS, makeBody: body, makeExisting: () => f.createFactory() });
});

describe("FR-001 warehouses", () => {
  const path = "/api/v1/warehouses";
  const body = async (extra = {}) => ({ name: "Main", code: `WH-${Math.random().toString(36).slice(2, 8)}`, factoryId: (await f.createFactory()).id, ...extra });

  it("creates, reads, updates and deactivates a warehouse", async () => {
    const created = await api().post(path).send(await body({ code: "WH-1" }));
    expect(created.status).toBe(201);

    const id = created.body.data.id;
    expect((await api().get(`${path}/${id}`)).body.data.code).toBe("WH-1");
    expect((await api().patch(`${path}/${id}`).send({ name: "Renamed" })).body.data.name).toBe("Renamed");
    expect((await api().delete(`${path}/${id}`)).status).toBe(200);
    expect((await api().get(`${path}/${id}`)).body.data.isActive).toBe(false);
  });

  it("400 for a missing name and a non-integer factory id", async () => {
    expect((await api().post(path).send(await body({ name: "" }))).status).toBe(400);
    expect((await api().post(path).send(await body({ factoryId: 1.5 }))).status).toBe(400);
  });

  it("404 for an unknown factory and an unknown warehouse", async () => {
    expect((await api().post(path).send(await body({ factoryId: 999999 }))).status).toBe(404);
    expect((await api().get(`${path}/999999`)).status).toBe(404);
  });

  it("409 for a duplicate code within the same factory, 201 in another factory", async () => {
    const { factoryId } = await body();
    await api().post(path).send(await body({ code: "DUP", factoryId }));

    expect((await api().post(path).send(await body({ code: "DUP", factoryId }))).status).toBe(409);
    expect((await api().post(path).send(await body({ code: "DUP" }))).status).toBe(201);
  });

  accessTests({ path, writers: MASTER_DATA_WRITERS, makeBody: body, makeExisting: () => f.createWarehouse() });
});

describe("FR-002 products", () => {
  const path = "/api/v1/products";
  const body = (extra = {}) => ({ sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, name: "Oil Filter", price: 12.5, unit: "pcs", ...extra });

  it("creates with SKU, optional barcode, unit, price and stock attributes, then reads it back", async () => {
    const created = await api().post(path).send(body({ sku: "OF-1", barcode: "8901234567890", reorderLevel: 20, minStock: 5, maxStock: 100, isStockTracked: true }));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ sku: "OF-1", barcode: "8901234567890", unit: "pcs", reorderLevel: 20, minStock: 5, maxStock: 100, isActive: true });
    expect(String(created.body.data.price)).toBe("12.5");

    const read = await api().get(`${path}/${created.body.data.id}`);
    expect(read.status).toBe(200);
    expect(read.body.data.sku).toBe("OF-1");
  });

  it("lists with pagination, search and the active filter", async () => {
    await api().post(path).send(body({ sku: "AAA-1", name: "Brake Pad" }));
    const second = (await api().post(path).send(body({ sku: "BBB-1", name: "Spark Plug" }))).body.data;
    await api().delete(`${path}/${second.id}`);

    const search = await api().get(`${path}?search=Brake&page=1&limit=10`);
    expect(search.status).toBe(200);
    expect(search.body.data.map((p) => p.sku)).toEqual(["AAA-1"]);

    const active = await api().get(`${path}?isActive=true&limit=50`);
    expect(active.body.data.map((p) => p.sku)).not.toContain("BBB-1");
  });

  it("updates fields, including clearing the barcode, and deactivates instead of deleting", async () => {
    const id = (await api().post(path).send(body({ barcode: "123" }))).body.data.id;

    const updated = await api().patch(`${path}/${id}`).send({ name: "Renamed", price: 99.99, barcode: null });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: "Renamed", barcode: null });

    expect((await api().delete(`${path}/${id}`)).status).toBe(200);
    expect((await api().get(`${path}/${id}`)).body.data.isActive).toBe(false);
  });

  it.each([
    ["a missing SKU", { sku: undefined }],
    ["an empty name", { name: " " }],
    ["a zero price", { price: 0 }],
    ["a negative price", { price: -1 }],
    ["a price sent as text", { price: "12.5" }],
    ["a missing unit", { unit: undefined }],
    ["a negative reorder level", { reorderLevel: -1 }],
    ["a fractional minimum stock", { minStock: 1.5 }],
    ["a maximum below the minimum", { minStock: 10, maxStock: 5 }],
  ])("400 for %s", async (_label, extra) => {
    const res = await api().post(path).send(body(extra));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("400 when an update would put the maximum below the existing minimum", async () => {
    const id = (await api().post(path).send(body({ minStock: 10 }))).body.data.id;

    expect((await api().patch(`${path}/${id}`).send({ maxStock: 5 })).status).toBe(400);
  });

  it("409 for a duplicate SKU on create and update, and for a duplicate barcode", async () => {
    await api().post(path).send(body({ sku: "DUP", barcode: "B-1" }));

    expect((await api().post(path).send(body({ sku: "DUP" }))).status).toBe(409);
    expect((await api().post(path).send(body({ barcode: "B-1" }))).status).toBe(409);

    const other = (await api().post(path).send(body({ sku: "OTHER" }))).body.data;
    expect((await api().patch(`${path}/${other.id}`).send({ sku: "DUP" })).status).toBe(409);
  });

  it("404 for an unknown product and an unknown category; 400 for a malformed id", async () => {
    expect((await api().get(`${path}/999999`)).status).toBe(404);
    expect((await api().patch(`${path}/999999`).send({ name: "x" })).status).toBe(404);
    expect((await api().delete(`${path}/999999`)).status).toBe(404);
    expect((await api().post(path).send(body({ categoryId: 999999 }))).status).toBeGreaterThanOrEqual(400);
    expect((await api().get(`${path}/abc`)).status).toBe(400);
  });

  accessTests({ path, writers: MASTER_DATA_WRITERS, makeBody: async () => body(), makeExisting: () => f.createProduct() });
});

describe("FR-003 suppliers", () => {
  const path = "/api/v1/suppliers";
  const body = (extra = {}) => ({ name: "Acme Parts", code: `SUP-${Math.random().toString(36).slice(2, 8)}`, email: "sales@acme.test", paymentTermsDays: 30, ...extra });

  it("creates a profile, reads it, updates it and toggles the active state", async () => {
    const created = await api().post(path).send(body({ code: "SUP-1" }));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "SUP-1", email: "sales@acme.test", paymentTermsDays: 30, isActive: true });

    const id = created.body.data.id;
    expect((await api().get(path)).body.data.map((s) => s.id)).toContain(id);

    const updated = await api().patch(`${path}/${id}`).send({ phone: "+880 1", email: null, paymentTermsDays: 45 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ phone: "+880 1", email: null, paymentTermsDays: 45 });

    expect((await api().delete(`${path}/${id}`)).status).toBe(200);
    expect((await api().get(`${path}/${id}`)).body.data.isActive).toBe(false);

    const back = await api().patch(`${path}/${id}`).send({ isActive: true });
    expect(back.body.data.isActive).toBe(true);
  });

  it.each([
    ["a missing name", { name: undefined }],
    ["an empty code", { code: "" }],
    ["an invalid email", { email: "not-an-email" }],
    ["negative payment terms", { paymentTermsDays: -1 }],
    ["fractional payment terms", { paymentTermsDays: 1.5 }],
  ])("400 for %s", async (_label, extra) => {
    const res = await api().post(path).send(body(extra));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("409 for a duplicate code on create and update", async () => {
    await api().post(path).send(body({ code: "DUP" }));
    expect((await api().post(path).send(body({ code: "DUP" }))).status).toBe(409);

    const other = (await api().post(path).send(body({ code: "OTHER" }))).body.data;
    expect((await api().patch(`${path}/${other.id}`).send({ code: "DUP" })).status).toBe(409);
  });

  it("404 for an unknown supplier on read, update and deactivate", async () => {
    expect((await api().get(`${path}/999999`)).status).toBe(404);
    expect((await api().patch(`${path}/999999`).send({ name: "x" })).status).toBe(404);
    expect((await api().delete(`${path}/999999`)).status).toBe(404);
  });

  accessTests({ path, writers: PROCUREMENT_WRITERS, makeBody: async () => body(), makeExisting: () => f.createSupplier() });
});

describe("FR-004 supplier-products", () => {
  const path = "/api/v1/supplier-products";
  const setup = async (extra = {}) => ({ supplierId: (await f.createSupplier()).id, productId: (await f.createProduct()).id, unitPrice: 8.25, ...extra });

  it("links a supplier to a product with SKU, price, lead time, MOQ and preferred flag", async () => {
    const created = await api().post(path).send(await setup({ supplierSku: "ACME-OF", leadTimeDays: 7, minimumOrderQty: 50, isPreferred: true }));

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ supplierSku: "ACME-OF", leadTimeDays: 7, minimumOrderQty: 50, isPreferred: true });
    expect(String(created.body.data.unitPrice)).toBe("8.25");

    const id = created.body.data.id;
    expect((await api().get(`${path}/${id}`)).body.data.id).toBe(id);
    expect((await api().get(path)).body.data.map((r) => r.id)).toContain(id);
  });

  it("keeps one preferred supplier per product, on create and on update", async () => {
    const product = await f.createProduct();
    const first = (await api().post(path).send(await setup({ productId: product.id, isPreferred: true }))).body.data;
    const second = (await api().post(path).send(await setup({ productId: product.id, isPreferred: true }))).body.data;

    expect((await api().get(`${path}/${first.id}`)).body.data.isPreferred).toBe(false);
    expect((await api().get(`${path}/${second.id}`)).body.data.isPreferred).toBe(true);

    const flipped = await api().patch(`${path}/${first.id}`).send({ isPreferred: true });
    expect(flipped.status).toBe(200);
    expect((await api().get(`${path}/${second.id}`)).body.data.isPreferred).toBe(false);
  });

  it("updates price, lead time and MOQ", async () => {
    const id = (await api().post(path).send(await setup())).body.data.id;
    const updated = await api().patch(`${path}/${id}`).send({ unitPrice: 9.75, leadTimeDays: 3, minimumOrderQty: 10 });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ leadTimeDays: 3, minimumOrderQty: 10 });
    expect(String(updated.body.data.unitPrice)).toBe("9.75");
  });

  it("409 for a second link between the same supplier and product", async () => {
    const link = await setup();

    expect((await api().post(path).send(link)).status).toBe(201);
    expect((await api().post(path).send(link)).status).toBe(409);
  });

  it.each([
    ["a zero unit price", { unitPrice: 0 }],
    ["a negative unit price", { unitPrice: -5 }],
    ["a missing supplier", { supplierId: undefined }],
    ["a missing product", { productId: undefined }],
    ["a negative lead time", { leadTimeDays: -1 }],
    ["a zero minimum order quantity", { minimumOrderQty: 0 }],
    ["a unit price sent as text", { unitPrice: "8.25" }],
  ])("400 for %s", async (_label, extra) => {
    const res = await api().post(path).send(await setup(extra));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("400 for an invalid update", async () => {
    const id = (await api().post(path).send(await setup())).body.data.id;

    expect((await api().patch(`${path}/${id}`).send({ unitPrice: -1 })).status).toBe(400);
    expect((await api().patch(`${path}/${id}`).send({ minimumOrderQty: 0 })).status).toBe(400);
  });

  it("404 for an unknown supplier, product or link; 409 for an inactive supplier or product", async () => {
    expect((await api().post(path).send(await setup({ supplierId: 999999 }))).status).toBe(404);
    expect((await api().post(path).send(await setup({ productId: 999999 }))).status).toBe(404);
    expect((await api().get(`${path}/999999`)).status).toBe(404);
    expect((await api().patch(`${path}/999999`).send({ unitPrice: 1 })).status).toBe(404);

    const inactiveSupplier = await f.createSupplier({ isActive: false });
    const inactiveProduct = await f.createProduct({ isActive: false });

    expect((await api().post(path).send(await setup({ supplierId: inactiveSupplier.id }))).status).toBe(409);
    expect((await api().post(path).send(await setup({ productId: inactiveProduct.id }))).status).toBe(409);
  });

  accessTests({
    path,
    writers: PROCUREMENT_WRITERS,
    makeBody: setup,
    makeExisting: async () => (await api().post(path).send(await setup())).body.data,
  });
});
