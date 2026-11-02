const request = require("supertest");

const app = require("../../src/app");
const roles = require("../../src/middlewares/roles");
const { resetDatabase, disconnect } = require("../helpers/db");
const { createUser, bearer } = require("../helpers/auth");

beforeEach(resetDatabase);
afterAll(disconnect);

const ALL = ["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER", "VIEWER"];

// prefix -> router module -> roles allowed to write (per route overrides below)
const MOUNTS = [
  ["/api/v1/sales-orders", "../../src/routes/sales-order.routes", roles.MASTER_DATA],
  ["/api/v1/companies", "../../src/routes/company.routes", roles.MASTER_DATA],
  ["/api/v1/factories", "../../src/routes/factory.routes", roles.MASTER_DATA],
  ["/api/v1/warehouses", "../../src/routes/warehouse.routes", roles.MASTER_DATA],
  ["/api/v1/products", "../../src/routes/product.routes", roles.MASTER_DATA],
  ["/api/v1/suppliers", "../../src/routes/supplier.routes", roles.PROCUREMENT],
  ["/api/v1/supplier-products", "../../src/routes/supplier-product.routes", roles.PROCUREMENT],
  ["/api/v1/inventory", "../../src/routes/inventory.routes", roles.STOCK],
  ["/api/v1/stock-transfers", "../../src/routes/stock-transfer.routes", roles.STOCK],
  ["/api/v1/customers", "../../src/routes/customer.routes", roles.MASTER_DATA],
  ["/api/v1/procurement", "../../src/routes/procurement.routes", null],
  ["/api/v1/ai", "../../src/routes/ai.routes", null],
];

// routes that name their own roles (the router has no single write list)
const PER_ROUTE_WRITES = {
  "POST /replenishment/run": roles.PROCUREMENT,
  "POST /requisitions": roles.PROCUREMENT,
  "POST /requisitions/:id/submit": roles.PROCUREMENT,
  "POST /requisitions/:id/approve": roles.PROCUREMENT,
  "POST /purchase-orders": roles.PROCUREMENT,
  "POST /purchase-orders/:id/approve": roles.PROCUREMENT,
  "POST /goods-receipts": roles.GOODS_RECEIPT,
  "POST /purchase-invoices": roles.PROCUREMENT,
};

// Every route declared by each router module, as [METHOD, fullPath, writeRoles | null for reads].
const declared = () =>
  MOUNTS.flatMap(([prefix, mod, writeRoles]) => {
    const router = require(mod);

    return router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) =>
        Object.keys(layer.route.methods).map((method) => {
          const verb = method.toUpperCase();
          const write = verb !== "GET";
          const allowed = !write ? null : writeRoles ?? PER_ROUTE_WRITES[`${verb} ${layer.route.path}`];

          return { verb, path: `${prefix}${layer.route.path === "/" ? "" : layer.route.path}`, allowed, key: `${verb} ${layer.route.path}` };
        })
      );
  });

const concrete = (path) => path.replace(/:[A-Za-z]+/g, "999999");

describe("route access matrix", () => {
  it("covers every declared route, and every write has a role list (nothing is accidentally open)", () => {
    const routes = declared();

    expect(routes.length).toBeGreaterThan(40);
    for (const r of routes.filter((x) => x.verb !== "GET")) {
      expect({ route: `${r.verb} ${r.path}`, hasRoles: Boolean(r.allowed) }).toEqual({ route: `${r.verb} ${r.path}`, hasRoles: true });
    }
  });

  it.each(declared().map((r) => [`${r.verb} ${r.path}`, r]))("%s", async (name, r) => {
    const call = (token) => {
      const req = request(app)[r.verb.toLowerCase()](concrete(r.path));

      return (token ? req.set("Authorization", bearer(token)) : req).send({});
    };

    // no token / bad token: 401, whatever the route
    expect((await call(null)).status).toBe(401);
    expect((await call("garbage")).status).toBe(401);

    for (const role of ALL) {
      const { token } = await createUser(role);
      const status = (await call(token)).status;

      if (r.allowed === null || r.allowed.includes(role)) {
        expect({ role, name, rejected: [401, 403].includes(status) }).toEqual({ role, name, rejected: false });
      } else {
        expect({ role, name, status }).toEqual({ role, name, status: 403 });
      }
    }
  });

  it("unknown paths stay 404 and the login route is public", async () => {
    expect((await request(app).get("/api/v1/nothing-here")).status).toBe(404);
    expect((await request(app).post("/api/v1/auth/login").send({})).status).toBe(400);
  });
});
