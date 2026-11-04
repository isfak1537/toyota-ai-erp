const http = require("http");

const { createAiClient } = require("../../src/modules/ai/ai.client");
const { ServiceUnavailableError } = require("../../src/errors/app-error");

const SECRET = "unit-test-shared-secret-123456";

// A real HTTP server so the client's fetch, headers, timeouts and socket errors are exercised for real.
let server;
let baseUrl;
let handler;
let seen;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";

    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, secret: req.headers["x-ai-service-secret"], body: raw ? JSON.parse(raw) : null });
      handler(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  seen = [];
  handler = (req, res) => json(res, 200, { ok: true });
});

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const client = (options = {}) => createAiClient({ baseUrl, secret: SECRET, timeoutMs: 300, trainTimeoutMs: 1000, ...options });

const rejection = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("expected a rejection");
};

describe("ai client requests", () => {
  it("sends the secret header and the JSON body, and returns the parsed response", async () => {
    handler = (req, res) => json(res, 200, { results: [1, 2] });

    const out = await client().forecast({ series: [{ productId: 1, warehouseId: 2 }], horizonDays: 14 });

    expect(out).toEqual({ results: [1, 2] });
    expect(seen).toEqual([
      { method: "POST", url: "/forecast", secret: SECRET, body: { series: [{ productId: 1, warehouseId: 2 }], horizonDays: 14 } },
    ]);
  });

  it("calls the right path for each operation (health is a GET)", async () => {
    const c = client();

    await c.health();
    await c.scoreAnomalies({ transactionIds: [1] });
    await c.train({ models: ["anomaly"] });

    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /health", "POST /anomalies/score", "POST /train"]);
  });

  it("tolerates a trailing slash on the base URL", async () => {
    await client({ baseUrl: `${baseUrl}/` }).health();

    expect(seen[0].url).toBe("/health");
  });
});

describe("ai client failures become 503 without leaking anything", () => {
  const expect503 = (error, pattern) => {
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.statusCode).toBe(503);
    expect(error.message).toMatch(pattern);
    expect(error.message).not.toContain(SECRET);
  };

  it("401 from the service means the secrets differ", async () => {
    handler = (req, res) => json(res, 401, { detail: "Invalid or missing shared secret" });

    expect503(await rejection(client().forecast({})), /rejected the shared secret/);
  });

  it("503 with a detail (no model trained yet) is passed on as a short message", async () => {
    handler = (req, res) => json(res, 503, { detail: "No active forecast model. Call POST /train first." });

    expect503(await rejection(client().forecast({})), /POST \/train first/);
  });

  it("422 and 500 are reported with their status, and the detail is truncated", async () => {
    handler = (req, res) => json(res, 422, { detail: "x".repeat(500) });
    const long = await rejection(client().forecast({}));
    expect503(long, /HTTP 422/);
    expect(long.message.length).toBeLessThan(300);

    handler = (req, res) => json(res, 500, "boom");
    expect503(await rejection(client().forecast({})), /HTTP 500/);
  });

  it("a response that is not JSON is an unreadable response", async () => {
    handler = (req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>proxy error</html>");
    };

    expect503(await rejection(client().health()), /unreadable/);
  });

  it("a slow service times out", async () => {
    handler = () => {}; // never answers

    expect503(await rejection(client({ timeoutMs: 100 }).health()), /timed out/);
  });

  it("a service that is down is unavailable", async () => {
    const dead = http.createServer();
    await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${dead.address().port}`;
    await new Promise((resolve) => dead.close(resolve));

    expect503(await rejection(client({ baseUrl: url }).health()), /unavailable/);
  });

  it("refuses to call without a configured secret, and never sends a request", async () => {
    expect503(await rejection(client({ secret: "" }).health()), /not configured/);
    expect(seen).toHaveLength(0);
  });
});

describe("retry policy", () => {
  const dropFirst = () => {
    let calls = 0;

    handler = (req, res) => {
      calls += 1;

      if (calls === 1) {
        req.socket.destroy(); // connection reset mid-request
      } else {
        json(res, 200, { ok: true, calls });
      }
    };
  };

  it("reads retry once after a network error", async () => {
    dropFirst();

    expect(await client().forecast({})).toEqual({ ok: true, calls: 2 });
    expect(seen).toHaveLength(2);
  });

  it("training is never retried", async () => {
    dropFirst();

    expect(await rejection(client().train({}))).toBeInstanceOf(ServiceUnavailableError);
    expect(seen).toHaveLength(1);
  });

  it("an HTTP error response is not retried", async () => {
    handler = (req, res) => json(res, 500, { detail: "bad" });

    await rejection(client().forecast({}));

    expect(seen).toHaveLength(1);
  });

  it("training gets the longer timeout", async () => {
    handler = (req, res) => setTimeout(() => json(res, 200, { trained: [] }), 500);

    expect(await client({ timeoutMs: 100, trainTimeoutMs: 2000 }).train({})).toEqual({ trained: [] });
    expect(await rejection(client({ timeoutMs: 100 }).health())).toBeInstanceOf(ServiceUnavailableError);
  });
});

describe("the shared secret is not sent in clear text across a network", () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const attempt = (baseUrl, extra = {}) => {
    const calls = [];
    const client = createAiClient({ baseUrl, secret: SECRET, fetchImpl: async (...a) => { calls.push(a); return ok(); }, ...extra });

    return { calls, result: client.health().then(() => "sent", (e) => e.message) };
  };

  it.each(["https://ai.example.com", "http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "https://ai.onrender.com/"])("sends to %s", async (url) => {
    const { calls, result } = attempt(url);

    expect(await result).toBe("sent");
    expect(calls).toHaveLength(1);
  });

  it.each(["http://ai.example.com", "http://10.0.0.5:8000", "http://ai-service:10000", "not a url", ""])("refuses %j and sends nothing", async (url) => {
    const { calls, result } = attempt(url);

    expect(await result).toMatch(/Refusing to send the shared secret over plain http/);
    expect(calls).toHaveLength(0);
  });

  it("can be allowed on purpose for a private network", async () => {
    const { calls, result } = attempt("http://ai-service:10000", { allowPlainHttp: true });

    expect(await result).toBe("sent");
    expect(calls).toHaveLength(1);
  });
});
