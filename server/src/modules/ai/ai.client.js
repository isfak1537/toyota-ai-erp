const env = require("../../config/env");
const { ServiceUnavailableError } = require("../../errors/app-error");

const SECRET_HEADER = "X-AI-Service-Secret";
const MAX_DETAIL = 200;

// Short, safe text from the AI service's error body (FastAPI uses `detail`).
const detailOf = (body) => {
  const detail = body && typeof body.detail === "string" ? body.detail : "";

  return detail.slice(0, MAX_DETAIL);
};

// HTTP client for the Python AI service (SRS section 3 and 9). Every failure becomes a
// ServiceUnavailableError (503) so a feature can degrade instead of crashing (NFR-014);
// messages never contain the shared secret or raw response bodies.
//
// Idempotent reads (health, forecast, scoring) retry once after a network error.
// Training is never retried.
const createAiClient = ({
  baseUrl = env.aiServiceUrl,
  secret = env.aiServiceSecret,
  timeoutMs = env.aiTimeoutMs,
  trainTimeoutMs = env.aiTrainTimeoutMs,
  fetchImpl = (...args) => fetch(...args),
} = {}) => {
  const attempt = async (path, { method, body, timeout }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          [SECRET_HEADER]: secret,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const request = async (path, { method = "POST", body, timeout = timeoutMs, retry = false } = {}) => {
    if (!secret) {
      throw new ServiceUnavailableError("AI service is not configured (AI_SERVICE_SECRET is empty)");
    }

    let response;

    for (let tries = retry ? 2 : 1; tries > 0; tries -= 1) {
      try {
        response = await attempt(path, { method, body, timeout });
        break;
      } catch (error) {
        const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";

        if (timedOut) {
          throw new ServiceUnavailableError("AI service timed out");
        }

        if (tries === 1) {
          throw new ServiceUnavailableError("AI service is unavailable");
        }
      }
    }

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok) {
      if (payload === null || typeof payload !== "object") {
        throw new ServiceUnavailableError("AI service returned an unreadable response");
      }

      return payload;
    }

    if (response.status === 401) {
      throw new ServiceUnavailableError("AI service rejected the shared secret");
    }

    const detail = detailOf(payload);

    if (response.status === 503) {
      throw new ServiceUnavailableError(detail || "AI service is not ready");
    }

    throw new ServiceUnavailableError(
      `AI service could not handle the request (HTTP ${response.status})${detail ? `: ${detail}` : ""}`
    );
  };

  return {
    health: () => request("/health", { method: "GET", retry: true }),
    forecast: (body) => request("/forecast", { body, retry: true }),
    scoreAnomalies: (body) => request("/anomalies/score", { body, retry: true }),
    train: (body = {}) => request("/train", { body, timeout: trainTimeoutMs }),
  };
};

// One shared client, built from the environment on first use. Tests replace it.
let shared = null;

const getAiClient = () => {
  shared ||= createAiClient();

  return shared;
};

const setAiClient = (client) => {
  shared = client;
};

module.exports = { createAiClient, getAiClient, setAiClient };
