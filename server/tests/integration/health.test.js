// NFR-011: the API has a public health endpoint that also checks the database.
const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/prisma");
const { disconnect } = require("../helpers/db");

afterAll(disconnect);

describe("GET /health", () => {
  it("answers 200 without a login, with the database state and no data", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "toyota-erp-api", database: "ok" });
  });

  it("answers 503 degraded when the database does not respond", async () => {
    const spy = jest.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("down"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "degraded", service: "toyota-erp-api", database: "unavailable" });
    spy.mockRestore();
  });
});
