// Verification (SRS section 9 role matrix, AUTH-001): the nine named actions for each role, and without a token.
// Allowed roles must get past authorization (the request then fails on the invented id or empty body, not on 401/403);
// everyone else must get 403; no token must get 401. The table is printed so it can be quoted.
const request = require("supertest");

const app = require("../../src/app");
const { resetDatabase, disconnect } = require("../helpers/db");
const { createUser, bearer } = require("../helpers/auth");
const { startFakeAiService } = require("../helpers/fake-ai-service");

let fakeAi;

beforeAll(async () => {
  fakeAi = await startFakeAiService();
});
beforeEach(resetDatabase);
afterAll(async () => {
  await fakeAi.stop();
  await disconnect();
});

const ALL = ["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER", "VIEWER"];
const PROCUREMENT = ["ADMIN", "PROCUREMENT_OFFICER"];

const ACTIONS = [
  { name: "run replenishment", method: "post", path: "/api/v1/ai/replenishment/run", allowed: PROCUREMENT },
  { name: "approve suggestion", method: "post", path: "/api/v1/ai/suggestions/999999/approve", allowed: PROCUREMENT },
  { name: "new requisition", method: "post", path: "/api/v1/procurement/requisitions", allowed: PROCUREMENT },
  { name: "approve requisition", method: "post", path: "/api/v1/procurement/requisitions/999999/approve", allowed: PROCUREMENT },
  { name: "create PO", method: "post", path: "/api/v1/procurement/purchase-orders", allowed: PROCUREMENT },
  { name: "receive goods", method: "post", path: "/api/v1/procurement/goods-receipts", allowed: ["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER"] },
  { name: "view anomalies", method: "get", path: "/api/v1/ai/anomalies?status=OPEN", allowed: ALL },
  { name: "retrain models", method: "post", path: "/api/v1/ai/models/retrain", allowed: ["ADMIN"] },
  { name: "view audit log", method: "get", path: "/api/v1/ai/audit", allowed: ["ADMIN"] },
];

describe("role matrix for the nine MVP actions", () => {
  it("allowed roles pass authorization, the others get 403, no token gets 401", async () => {
    const tokens = {};
    for (const role of ALL) tokens[role] = (await createUser(role)).token;

    const table = [];
    const failures = [];

    for (const a of ACTIONS) {
      const row = { action: a.name };

      for (const role of [...ALL, "NO TOKEN"]) {
        const req = request(app)[a.method](a.path);
        const res = await (role === "NO TOKEN" ? req : req.set("Authorization", bearer(tokens[role]))).send(a.method === "post" ? {} : undefined);

        row[role] = res.status;

        const ok = role === "NO TOKEN" ? res.status === 401 : a.allowed.includes(role) ? ![401, 403].includes(res.status) : res.status === 403;
        if (!ok) failures.push(`${a.name} as ${role}: HTTP ${res.status}`);
        if (a.method === "get" && a.allowed.includes(role)) expect(res.status).toBe(200);
      }
      table.push(row);
    }

    process.stdout.write(`\nROLE MATRIX (HTTP status)\n${JSON.stringify(table)}\n`);
    expect(failures).toEqual([]);
  });
});
