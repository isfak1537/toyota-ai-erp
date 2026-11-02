const request = require("supertest");

const app = require("../../src/app");

describe("app", () => {
  it("loads without listening on a port", () => {
    expect(typeof app).toBe("function");
    expect(typeof app.listen).toBe("function");
  });

  it("returns a JSON 404 for an unknown route", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Route not found" });
  });
});
