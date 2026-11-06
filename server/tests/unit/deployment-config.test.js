const fs = require("fs");
const path = require("path");
const request = require("supertest");

const root = path.resolve(__dirname, "../..");

// the app reads its settings when it loads, so each case loads a fresh copy with its own environment
const loadApp = (vars = {}) => {
  const saved = { ...process.env };

  Object.assign(process.env, { JWT_SECRET: "test-only-jwt-secret-0123456789abcdef0123456789", ...vars });
  for (const [key, value] of Object.entries(vars)) if (value === undefined) delete process.env[key];

  let app;
  jest.isolateModules(() => {
    app = require("../../src/app");
  });
  process.env = saved;

  return app;
};

describe("hardening that does not depend on the host", () => {
  it("does not announce the framework and sets the response headers an API needs", async () => {
    const res = await request(loadApp()).get("/api/v1/nothing-here");

    expect(res.status).toBe(404);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("sets them on error responses too", async () => {
    const res = await request(loadApp()).post("/api/v1/auth/login").send({});

    expect(res.status).toBe(400);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("CORS (CLIENT_URL)", () => {
  const origin = async (app, from) => (await request(app).get("/api/v1/nothing-here").set("Origin", from)).headers["access-control-allow-origin"];

  it("allows the local client by default and nobody else", async () => {
    const app = loadApp({ CLIENT_URL: undefined });

    expect(await origin(app, "http://localhost:5173")).toBe("http://localhost:5173");
    expect(await origin(app, "https://evil.example")).toBeUndefined();
  });

  it("allows each of several listed origins, ignores spaces and a trailing slash, and refuses the rest", async () => {
    const app = loadApp({ CLIENT_URL: "https://erp.example.com/ , https://erp-preview.example.com" });

    expect(await origin(app, "https://erp.example.com")).toBe("https://erp.example.com");
    expect(await origin(app, "https://erp-preview.example.com")).toBe("https://erp-preview.example.com");
    expect(await origin(app, "https://erp.example.com.evil.example")).toBeUndefined();
    expect(await origin(app, "http://erp.example.com")).toBeUndefined(); // another scheme is another origin
  });
});

describe("settings read from the environment", () => {
  const settings = (vars) => {
    const saved = { ...process.env };

    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    let env;
    jest.isolateModules(() => {
      env = require("../../src/config/env");
    });
    const out = { trustProxy: env.trustProxy, dbPoolMax: env.dbPoolMax, origins: env.clientOrigins };
    process.env = saved;

    return out;
  };

  it.each([
    [undefined, false],
    ["", false],
    ["1", 1],
    ["2", 2],
    ["true", 1],
    ["TRUE", 1],
    ["false", false],
    ["garbage", false],
  ])("TRUST_PROXY=%s -> %p (off unless asked for)", (value, expected) => {
    expect(settings({ TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  it.each([
    [undefined, 10],
    ["3", 3],
    ["0", 10],
    ["-2", 10],
    ["many", 10],
    ["2.5", 10],
  ])("DB_POOL_MAX=%s -> %p", (value, expected) => {
    expect(settings({ DB_POOL_MAX: value }).dbPoolMax).toBe(expected);
  });
});

describe("hosting files", () => {
  it("the Vercel entry point exports the very same app", () => {
    expect(require("../../api/index")).toBe(require("../../src/app"));
  });

  it("vercel.json sends every path to the function and stays within the Hobby time limit (300 s)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

    expect(config.rewrites).toEqual([{ source: "/(.*)", destination: "/api/index" }]);
    expect(config.functions["api/index.js"].maxDuration).toBeLessThanOrEqual(300);
    expect(config.functions["api/index.js"].maxDuration).toBeGreaterThanOrEqual(60); // replenishment and sync call the AI service
  });

  it("generates the Prisma client when dependencies are installed (the generated client is not committed)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

    expect(pkg.scripts.postinstall).toBe("prisma generate");
  });

  it("migrations use the direct connection when one is given, and the pooled URL stays the runtime default", () => {
    const config = fs.readFileSync(path.join(root, "prisma.config.ts"), "utf8");

    expect(config).toMatch(/process\.env\["DIRECT_DATABASE_URL"\] \|\| process\.env\["DATABASE_URL"\]/);
  });
});
