const request = require("supertest");

const app = require("../../src/app");
const { resetDatabase, disconnect } = require("../helpers/db");
const { bearer } = require("../helpers/auth");
const { ensureDemoUsers, DEMO_USERS } = require("../../src/services/demo-users");

const PASSWORDS = {
  DEMO_ADMIN_PASSWORD: "admin-password-demo-1",
  DEMO_WAREHOUSE_PASSWORD: "warehouse-pass-demo-2",
  DEMO_PROCUREMENT_PASSWORD: "procurement-pw-demo-3",
  DEMO_VIEWER_PASSWORD: "viewer-password-demo-4",
};

const demoLogin = (body) => request(app).post("/api/v1/auth/demo-login").send(body);

let saved;

beforeEach(async () => {
  saved = process.env.DEMO_LOGIN_ENABLED;
  process.env.DEMO_LOGIN_ENABLED = "true";
  await resetDatabase();
  await ensureDemoUsers(PASSWORDS);
});

afterEach(() => {
  if (saved === undefined) delete process.env.DEMO_LOGIN_ENABLED;
  else process.env.DEMO_LOGIN_ENABLED = saved;
});

afterAll(disconnect);

describe("POST /auth/demo-login (enabled)", () => {
  it.each(DEMO_USERS)("signs in the seeded $role user with the same shape as /auth/login", async ({ role, email }) => {
    const res = await demoLogin({ role });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual(["token", "user"]);
    expect(res.body.data.user).toEqual({ id: expect.any(Number), name: expect.any(String), email, role });

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", bearer(res.body.data.token));
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe(role);
  });

  it("never returns a password or a hash", async () => {
    for (const { role } of DEMO_USERS) {
      const text = JSON.stringify((await demoLogin({ role })).body);

      expect(text).not.toMatch(/passwordHash|password|\$2[aby]\$/i);
      for (const password of Object.values(PASSWORDS)) expect(text).not.toContain(password);
    }
  });

  it.each([{}, { role: "SUPERUSER" }, { role: "admin" }, { role: 1 }, { role: "ADMIN", email: "x@y.z" }])("rejects an invalid body %j with 400", async (body) => {
    const res = await demoLogin(body);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("answers 404 when the demo user has not been seeded", async () => {
    await resetDatabase();

    const res = await demoLogin({ role: "VIEWER" });

    expect(res.status).toBe(404);
  });

  it("is rate limited per address (429)", async () => {
    let last;

    for (let i = 0; i < 31; i += 1) last = await demoLogin({ role: "VIEWER" });

    expect(last.status).toBe(429);
  });
});

describe("POST /auth/demo-login (disabled)", () => {
  it.each([undefined, "", "false", "1", "yes"])("answers 404 and no token when DEMO_LOGIN_ENABLED is %j", async (value) => {
    if (value === undefined) delete process.env.DEMO_LOGIN_ENABLED;
    else process.env.DEMO_LOGIN_ENABLED = value;

    const res = await demoLogin({ role: "ADMIN" });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it("answers 404 before validating the body", async () => {
    process.env.DEMO_LOGIN_ENABLED = "false";

    expect((await demoLogin({ role: "nope" })).status).toBe(404);
  });
});

describe("GET /auth/demo-status", () => {
  it("is public and reports the flag", async () => {
    const on = await request(app).get("/api/v1/auth/demo-status");

    expect(on.status).toBe(200);
    expect(on.body.data).toEqual({ enabled: true });

    process.env.DEMO_LOGIN_ENABLED = "false";
    const off = await request(app).get("/api/v1/auth/demo-status");

    expect(off.status).toBe(200);
    expect(off.body.data).toEqual({ enabled: false });
  });
});
