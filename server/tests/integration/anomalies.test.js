const request = require("supertest");

const app = require("../../src/app");
const { authed } = require("../helpers/http");
const { createUser } = require("../helpers/auth");
const { startFakeAiService } = require("../helpers/fake-ai-service");
const { settle, times } = require("../helpers/concurrency");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");

let fake;

beforeAll(async () => {
  fake = await startFakeAiService();
});
afterAll(async () => {
  await fake.stop();
  await disconnect();
});
beforeEach(async () => {
  await resetDatabase();
  fake.reset();
});

const api = () => authed(app);
const sync = (body = {}, token) => (token ? authed(app, token) : api()).post("/api/v1/ai/anomalies/sync").send(body);

// ledger rows to flag
const rows = async (n) => {
  const s = await f.stockScenario({ quantity: 100 });
  const out = [];

  for (let i = 0; i < n; i += 1) {
    out.push(await prisma.inventoryTransaction.create({ data: { productId: s.product.id, warehouseId: s.warehouse.id, type: "ISSUE", quantity: -1, balanceAfter: 99 - i, reservedAfter: 0 } }));
  }

  return out;
};

const flag = (id, extra = {}) => ({
  inventoryTransactionId: id,
  type: "ISSUE",
  score: 0.9,
  source: "RULE",
  ruleCodes: ["R2"],
  queueRank: null,
  period: "2026-11-01/2026-11-07",
  topFeatures: [],
  reason: "Issue of 8 units is 8.0x the usual 1 for this product",
  ...extra,
});

describe("POST /ai/anomalies/sync", () => {
  it("stores one flag per flagged transaction with score, source, rule codes, queue rank and reason", async () => {
    const [a, b] = await rows(2);
    fake.state.anomalies = {
      modelVersion: "anomaly-test-0007",
      scored: 431,
      flags: [
        flag(a.id),
        flag(b.id, { source: "BOTH", ruleCodes: ["R1"], queueRank: 2, score: 0.97, topFeatures: [{ feature: "size as a multiple of the usual", value: 8, typical: 1, contribution: 0.3 }] }),
      ],
    };

    const res = await sync({ from: "2026-10-20T00:00:00Z", to: "2026-11-02T00:00:00Z" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ modelVersion: "anomaly-test-0007", scored: 431, flagged: 2, created: 2, updated: 0, ignored: 0 });

    const stored = await prisma.anomalyFlag.findMany({ orderBy: { inventoryTransactionId: "asc" } });
    expect(stored[0]).toMatchObject({ inventoryTransactionId: a.id, source: "RULE", ruleCodes: ["R2"], queueRank: null, status: "OPEN", modelVersion: "anomaly-test-0007" });
    expect(stored[1]).toMatchObject({ source: "BOTH", ruleCodes: ["R1"], queueRank: 2, score: 0.97, period: "2026-11-01/2026-11-07" });
    expect(stored[1].topFeatures[0].feature).toBe("size as a multiple of the usual");

    // the request sent to the AI service carried the window
    expect(fake.state.calls.find((c) => c.url === "/anomalies/score").body).toMatchObject({ from: "2026-10-20T00:00:00Z", to: "2026-11-02T00:00:00Z" });
  });

  it("defaults to the last 7 days and passes the queue options through", async () => {
    await sync({ queueSize: 5, queuePeriod: "day" }).expect(200);
    const sent = fake.state.calls.find((c) => c.url === "/anomalies/score").body;

    expect(sent).toMatchObject({ queueSize: 5, queuePeriod: "day" });
    expect(Date.parse(sent.to) - Date.parse(sent.from)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("is idempotent: syncing again updates the scores and creates no duplicates", async () => {
    const [a] = await rows(1);
    fake.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id)] };
    await sync().expect(200);

    fake.state.anomalies = { modelVersion: "anomaly-test-0002", scored: 1, flags: [flag(a.id, { score: 0.5, source: "BOTH", queueRank: 1 })] };
    const again = await sync();

    expect(again.body.data).toMatchObject({ created: 0, updated: 1 });
    expect(await prisma.anomalyFlag.count()).toBe(1);
    expect(await prisma.anomalyFlag.findFirst()).toMatchObject({ score: 0.5, source: "BOTH", queueRank: 1, modelVersion: "anomaly-test-0002" });
  });

  it("never resets a review when the same transaction is flagged again", async () => {
    const [a] = await rows(1);
    const manager = await createUser("WAREHOUSE_MANAGER");
    fake.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id)] };
    await sync().expect(200);
    const id = (await prisma.anomalyFlag.findFirst()).id;
    await authed(app, manager.token).post(`/api/v1/ai/anomalies/${id}/review`).send({ note: "Counted, fine" }).expect(200);

    fake.state.anomalies = { modelVersion: "anomaly-test-0002", scored: 1, flags: [flag(a.id, { score: 0.99 })] };
    await sync().expect(200);

    expect(await prisma.anomalyFlag.findFirst()).toMatchObject({ status: "REVIEWED", reviewedById: manager.user.id, reviewNote: "Counted, fine", score: 0.99 });
  });

  it("ignores flags for transactions the ERP does not have, and concurrent syncs create no duplicates", async () => {
    const [a] = await rows(1);
    fake.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 2, flags: [flag(a.id), flag(987654)] };

    const { ok, failed } = await settle(times(6, () => sync().then((r) => r)));

    expect(failed).toEqual([]);
    expect(ok.map((r) => r.status)).toEqual(times(6, () => 200));
    expect(ok.every((r) => r.body.data.ignored === 1)).toBe(true);
    expect(await prisma.anomalyFlag.count()).toBe(1);
  });

  it("audits each sync", async () => {
    const [a] = await rows(1);
    const manager = await createUser("WAREHOUSE_MANAGER");
    fake.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 9, flags: [flag(a.id)] };

    await sync({}, manager.token).expect(200);
    const audit = await prisma.aiAuditLog.findMany({ where: { eventType: "ANOMALY_SYNC" } });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: manager.user.id, payload: { scored: 9, flagged: 1, created: 1 } });
  });

  it("503 when the AI service is down, with nothing stored", async () => {
    fake.state.down = true;

    const res = await sync();

    expect(res.status).toBe(503);
    expect(await prisma.anomalyFlag.count()).toBe(0);
    expect(await prisma.aiAuditLog.count()).toBe(0);
  });

  it.each([
    [{ from: "not a date" }],
    [{ from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" }],
    [{ from: "2026-11-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }],
    [{ from: "2026-09-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }],
    [{ transactionIds: [1], from: "2026-10-01T00:00:00Z" }],
    [{ transactionIds: [] }],
    [{ transactionIds: [0] }],
    [{ queueSize: 101 }],
    [{ queuePeriod: "month" }],
    [{ surprise: 1 }],
  ])("400 for %j", async (body) => {
    expect((await sync(body)).status).toBe(400);
    expect(fake.state.calls).toHaveLength(0);
  });

  it("only ADMIN and WAREHOUSE_MANAGER may sync", async () => {
    for (const [role, status] of [["VIEWER", 403], ["PROCUREMENT_OFFICER", 403], ["WAREHOUSE_MANAGER", 200], ["ADMIN", 200]]) {
      expect((await sync({}, (await createUser(role)).token)).status).toBe(status);
    }

    expect((await request(app).post("/api/v1/ai/anomalies/sync").send({})).status).toBe(401);
  });
});

describe("GET /ai/anomalies", () => {
  const seedFlags = async () => {
    const [a, b, c] = await rows(3);
    fake.state.anomalies = {
      modelVersion: "anomaly-test-0001",
      scored: 3,
      flags: [
        flag(a.id, { source: "RULE", ruleCodes: ["R3"] }), // rule only
        flag(b.id, { source: "MODEL", ruleCodes: [], queueRank: 1, score: 0.95 }), // queue only
        flag(c.id, { source: "BOTH", ruleCodes: ["R2"], queueRank: 2, score: 0.9 }), // both
      ],
    };
    await sync().expect(200);

    return { a, b, c };
  };

  it("kind=rule is the confirmed rule hits, kind=queue the weekly review queue; no kind lists everything", async () => {
    const { a, b, c } = await seedFlags();
    const ids = (res) => res.body.data.map((x) => x.inventoryTransactionId).sort((x, y) => x - y);

    expect(ids(await api().get("/api/v1/ai/anomalies?kind=rule"))).toEqual([a.id, c.id]);
    expect(ids(await api().get("/api/v1/ai/anomalies?kind=queue"))).toEqual([b.id, c.id]);
    expect(ids(await api().get("/api/v1/ai/anomalies"))).toEqual([a.id, b.id, c.id]);
  });

  it("orders the queue by period then rank, and includes the transaction, product and warehouse", async () => {
    await seedFlags();

    const res = await api().get("/api/v1/ai/anomalies?kind=queue");

    expect(res.body.data.map((x) => x.queueRank)).toEqual([1, 2]);
    expect(res.body.data[0].transaction).toMatchObject({ type: "ISSUE", product: { sku: expect.any(String) }, warehouse: { code: expect.any(String) } });
  });

  it("filters by status, paginates, and is readable by a VIEWER", async () => {
    await seedFlags();
    const first = await prisma.anomalyFlag.findFirst({ orderBy: { id: "asc" } });
    await authed(app, (await createUser("ADMIN")).token).post(`/api/v1/ai/anomalies/${first.id}/review`).send({}).expect(200);
    const viewer = authed(app, (await createUser("VIEWER")).token);

    expect((await viewer.get("/api/v1/ai/anomalies?status=OPEN")).body.pagination.total).toBe(2);
    expect((await viewer.get("/api/v1/ai/anomalies?status=REVIEWED")).body.pagination.total).toBe(1);

    const page = await viewer.get("/api/v1/ai/anomalies?pageSize=2&page=2");
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toMatchObject({ total: 3, totalPages: 2 });
  });

  it.each(["status=DONE", "kind=model", "pageSize=0"])("400 for %s", async (query) => {
    expect((await api().get(`/api/v1/ai/anomalies?${query}`)).status).toBe(400);
  });
});

describe("POST /ai/anomalies/:id/review", () => {
  const oneFlag = async () => {
    const [a] = await rows(1);
    fake.state.anomalies = { modelVersion: "anomaly-test-0001", scored: 1, flags: [flag(a.id)] };
    await sync().expect(200);

    return prisma.anomalyFlag.findFirst();
  };

  it("marks it reviewed with the reviewer, time and note, and audits it", async () => {
    const target = await oneFlag();
    const manager = await createUser("WAREHOUSE_MANAGER");

    const res = await authed(app, manager.token).post(`/api/v1/ai/anomalies/${target.id}/review`).send({ note: "  Recounted shelf, matches " });

    expect(res.status).toBe(200);
    expect(res.body.data.idempotent).toBe(false);
    expect(await prisma.anomalyFlag.findUnique({ where: { id: target.id } })).toMatchObject({ status: "REVIEWED", reviewedById: manager.user.id, reviewNote: "Recounted shelf, matches" });
    expect((await prisma.anomalyFlag.findUnique({ where: { id: target.id } })).reviewedAt).toBeInstanceOf(Date);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "ANOMALY_REVIEWED" } })).toBe(1);
  });

  it("a second review changes nothing and is not audited again (the first review stands)", async () => {
    const target = await oneFlag();
    const first = await createUser("WAREHOUSE_MANAGER");
    const second = await createUser("ADMIN");

    await authed(app, first.token).post(`/api/v1/ai/anomalies/${target.id}/review`).send({ note: "first" }).expect(200);
    const again = await authed(app, second.token).post(`/api/v1/ai/anomalies/${target.id}/review`).send({ note: "second" });

    expect(again.body.data.idempotent).toBe(true);
    expect(await prisma.anomalyFlag.findUnique({ where: { id: target.id } })).toMatchObject({ reviewedById: first.user.id, reviewNote: "first" });
    expect(await prisma.aiAuditLog.count({ where: { eventType: "ANOMALY_REVIEWED" } })).toBe(1);
  });

  it("parallel reviews: exactly one wins", async () => {
    const target = await oneFlag();
    const users = await Promise.all(times(4, () => createUser("WAREHOUSE_MANAGER")));

    const { ok } = await settle(times(8, (i) => authed(app, users[i % 4].token).post(`/api/v1/ai/anomalies/${target.id}/review`).send({ note: `n${i}` }).then((r) => r)));

    expect(ok.filter((r) => r.body.data.idempotent === false)).toHaveLength(1);
    expect(await prisma.aiAuditLog.count({ where: { eventType: "ANOMALY_REVIEWED" } })).toBe(1);
  });

  it("404 unknown, 400 bad id or note, 403 for VIEWER and PROCUREMENT_OFFICER", async () => {
    const target = await oneFlag();

    expect((await api().post("/api/v1/ai/anomalies/999999/review").send({})).status).toBe(404);
    expect((await api().post("/api/v1/ai/anomalies/abc/review").send({})).status).toBe(400);
    expect((await api().post(`/api/v1/ai/anomalies/${target.id}/review`).send({ note: "x".repeat(501) })).status).toBe(400);
    expect((await api().post(`/api/v1/ai/anomalies/${target.id}/review`).send({ status: "OPEN" })).status).toBe(400);

    for (const role of ["VIEWER", "PROCUREMENT_OFFICER"]) {
      expect((await authed(app, (await createUser(role)).token).post(`/api/v1/ai/anomalies/${target.id}/review`).send({})).status).toBe(403);
    }

    expect((await prisma.anomalyFlag.findUnique({ where: { id: target.id } })).status).toBe("OPEN");
  });
});
