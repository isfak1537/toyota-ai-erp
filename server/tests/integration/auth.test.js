const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../../src/app");
const errorMiddleware = require("../../src/middlewares/error.middleware");
const { authenticate, requireRole } = require("../../src/middlewares/auth.middleware");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const { createUser, bearer } = require("../helpers/auth");

beforeEach(resetDatabase);
afterAll(disconnect);

const login = (body) => request(app).post("/api/v1/auth/login").send(body);

describe("POST /auth/login", () => {
  it("returns a token and the public user for valid credentials", async () => {
    const { user, password } = await createUser("PROCUREMENT_OFFICER");

    const res = await login({ email: user.email.toUpperCase(), password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({ id: user.id, name: user.name, email: user.email, role: "PROCUREMENT_OFFICER" });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", bearer(res.body.data.token));
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(user.id);
  });

  it("stores a bcrypt hash, never the password", async () => {
    const { user, password } = await createUser("VIEWER");
    const stored = await prisma.user.findUnique({ where: { id: user.id } });

    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain(password);
  });

  it("gives the same 401 for a wrong password, an unknown email and an inactive user", async () => {
    const active = await createUser("ADMIN");
    const inactive = await createUser("ADMIN", { isActive: false });

    const results = await Promise.all([
      login({ email: active.user.email, password: "wrong-password-123" }),
      login({ email: "nobody@test.local", password: "whatever-123456" }),
      login({ email: inactive.user.email, password: inactive.password }),
    ]);

    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid email or password");
    }
  });

  it.each([
    [{}],
    [{ email: "not-an-email", password: "x" }],
    [{ email: "a@test.local" }],
    [{ email: "a@test.local", password: "" }],
    [{ email: "a@test.local", password: "x", role: "ADMIN" }],
    [{ email: "a@test.local", password: 12345 }],
  ])("rejects malformed input with 400: %j", async (body) => {
    expect((await login(body)).status).toBe(400);
  });

  it("limits repeated attempts for one email and address with 429", async () => {
    const { user } = await createUser("ADMIN");
    let last;

    for (let i = 0; i < 11; i += 1) {
      last = await login({ email: user.email, password: "wrong-password-123" });
    }

    expect(last.status).toBe(429);
  });
});

describe("token checks", () => {
  const me = (header) => {
    const r = request(app).get("/api/v1/auth/me");

    return header === undefined ? r : r.set("Authorization", header);
  };

  it("401 without a header, with a wrong scheme or with garbage", async () => {
    const { token } = await createUser("ADMIN");

    for (const header of [undefined, "", token, `Basic ${token}`, "Bearer", "Bearer not.a.jwt", `Bearer ${token} extra`]) {
      expect((await me(header)).status).toBe(401);
    }
  });

  it("401 for a token signed with another secret, an expired token and an unsigned (alg none) token", async () => {
    const { user } = await createUser("ADMIN");
    const sign = (secret, opts) => jwt.sign({ role: user.role }, secret, { subject: String(user.id), ...opts });
    const real = process.env.JWT_SECRET;
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: String(user.id), role: "ADMIN" })).toString("base64url")}.`;

    expect((await me(bearer(sign("a-different-secret-of-sufficient-length-123", {})))).status).toBe(401);
    expect((await me(bearer(sign(real, { expiresIn: -10 })))).status).toBe(401);
    expect((await me(bearer(none))).status).toBe(401);
    expect((await me(bearer(sign(real, { expiresIn: "1h" })))).status).toBe(200);
  });

  it("401 once the user is deactivated or deleted, and the stored role wins over the token's", async () => {
    const { user, token } = await createUser("VIEWER");

    // token claims VIEWER; promote in the database and the new role is what the app sees
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    expect((await me(bearer(token))).body.data.role).toBe("ADMIN");

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await me(bearer(token))).status).toBe(401);

    await prisma.user.delete({ where: { id: user.id } });
    expect((await me(bearer(token))).status).toBe(401);
  });
});

describe("requireRole", () => {
  const guarded = express();

  guarded.get("/admin-or-manager", authenticate, requireRole("ADMIN", "WAREHOUSE_MANAGER"), (req, res) => res.json({ ok: true }));
  guarded.get("/no-auth-middleware", requireRole("ADMIN"), (req, res) => res.json({ ok: true }));
  guarded.use(errorMiddleware);

  it.each([
    ["ADMIN", 200],
    ["WAREHOUSE_MANAGER", 200],
    ["PROCUREMENT_OFFICER", 403],
    ["VIEWER", 403],
  ])("%s gets %i", async (role, status) => {
    const { token } = await createUser(role);

    expect((await request(guarded).get("/admin-or-manager").set("Authorization", bearer(token))).status).toBe(status);
  });

  it("401 without a token, and fails closed if used without authenticate", async () => {
    expect((await request(guarded).get("/admin-or-manager")).status).toBe(401);
    expect((await request(guarded).get("/no-auth-middleware")).status).toBe(401);
  });
});
