// A real HTTP server that behaves like the Python AI service, so integration tests exercise the
// ERP's real ai.client over the wire without Python or a trained model.
const http = require("http");

const { createAiClient, setAiClient } = require("../../src/modules/ai/ai.client");

const SECRET = process.env.AI_SERVICE_SECRET;

const startFakeAiService = async () => {
  const state = {
    modelVersion: "forecast-test-0001",
    forecasts: new Map(), // "productId:warehouseId" -> { dailyMean, sigma, status, selectedModel }
    anomalies: { modelVersion: "anomaly-test-0001", flags: [], scored: 0 },
    calls: [],
    down: false,
  };

  const forecastFor = (productId, warehouseId, horizon = 30) => {
    const found = state.forecasts.get(`${productId}:${warehouseId}`);

    if (!found) {
      return { productId, warehouseId, status: "NO_HISTORY", message: "No ledger history for this product and warehouse" };
    }

    const days = Array.from({ length: horizon }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, mean: found.dailyMean, baseline: found.dailyMean, ml: found.dailyMean, sigma: found.sigma }));

    return {
      productId,
      warehouseId,
      status: "OK",
      modelVersion: state.modelVersion,
      selectedModel: found.selectedModel ?? "ML",
      dailyMean: found.dailyMean,
      sigma: found.sigma,
      metrics: { holdoutDays: 14, maeBaseline: 1.5, maeMl: 1.3 },
      inputs: { historyDays: 90, lastActualDate: "2026-11-01" },
      notes: [],
      history: [],
      forecast: days,
    };
  };

  const server = http.createServer((req, res) => {
    let raw = "";

    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      state.calls.push({ method: req.method, url: req.url, body });

      if (state.down) return req.socket.destroy();
      if (req.url !== "/health" && req.headers["x-ai-service-secret"] !== SECRET) return send(401, { detail: "Invalid or missing shared secret" });

      if (req.url === "/health") return send(200, { status: "ok", models: { forecast: state.modelVersion, anomaly: state.anomalies.modelVersion } });

      if (req.url === "/forecast") {
        return send(200, {
          modelVersion: state.modelVersion,
          asOf: "2026-11-01",
          horizonDays: body.horizonDays,
          results: body.series.map((s) => forecastFor(s.productId, s.warehouseId, body.horizonDays)),
        });
      }

      if (req.url === "/anomalies/score") {
        return send(200, { modelVersion: state.anomalies.modelVersion, queue: { size: body.queueSize ?? 10, period: body.queuePeriod ?? "week" }, scored: state.anomalies.scored, flagged: state.anomalies.flags.length, notFoundIds: [], flags: state.anomalies.flags });
      }

      if (req.url === "/train") {
        return send(200, { trained: (body.models ?? ["forecast", "anomaly"]).map((kind) => ({ kind, version: `${kind}-test-0002`, activated: true, metrics: { note: "fake" } })) });
      }

      return send(404, { detail: "not found" });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  setAiClient(createAiClient({ baseUrl: url, secret: SECRET, timeoutMs: 2000, trainTimeoutMs: 5000 }));

  return {
    state,
    url,
    setForecast: (productId, warehouseId, forecast) => state.forecasts.set(`${productId}:${warehouseId}`, forecast),
    reset: () => {
      state.forecasts.clear();
      state.calls.length = 0;
      state.down = false;
      state.anomalies = { modelVersion: "anomaly-test-0001", flags: [], scored: 0 };
    },
    stop: () => {
      setAiClient(null);

      return new Promise((resolve) => server.close(resolve));
    },
  };
};

module.exports = { startFakeAiService };
