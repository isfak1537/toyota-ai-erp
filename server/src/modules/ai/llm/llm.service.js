const env = require("../../../config/env");
const prisma = require("../../../config/prisma");
const { LlmError, providerFromConfig } = require("./provider");
const { writeAudit } = require("../../../services/audit.service");

const MINUTE_MS = 60 * 1000;

// Sliding one-minute window in memory; the daily cap counts today's LLM_CALL audit rows, so it
// survives restarts. Both are below the provider's free tier on purpose (NFR-015). With several
// server instances each keeps its own minute window; the daily count is shared.
//
// Capacity is reserved for people: background work (explanations generated after a run or a sync)
// may use at most half of the per-minute budget, so the assistant and on-demand explanations always
// have headroom, however large the background batch is.
const createRateLimiter = ({ perMinute, perDay, now = Date.now, callsToday }) => {
  let recent = []; // every call in the window: { at, background }
  const backgroundShare = Math.max(1, Math.floor(perMinute / 2));

  return {
    async tryAcquire({ background = false } = {}) {
      const t = now();

      recent = recent.filter((call) => t - call.at < MINUTE_MS);

      if (recent.length >= perMinute) return "RATE_PER_MINUTE";
      if (background && recent.filter((call) => call.background).length >= backgroundShare) return "RATE_BACKGROUND_RESERVE";
      if ((await callsToday()) >= perDay) return "RATE_PER_DAY";

      recent.push({ at: t, background });

      return null;
    },
  };
};

const startOfUtcDay = (t = Date.now()) => new Date(Math.floor(t / 86400000) * 86400000);

const countCallsToday = () => prisma.aiAuditLog.count({ where: { eventType: "LLM_CALL", createdAt: { gte: startOfUtcDay() } } });

// AI-009, AI-011, AI-012, NFR-014/015. `complete` returns the model's answer or null; it never
// throws. Providers are tried in order (primary, then fallback). Each attempt is written to the audit
// log (provider, model, purpose, outcome, latency; never the prompt or a key).
const createLlmService = ({ providers, limiter, audit = writeAudit, now = Date.now }) => ({
  enabled: providers.length > 0,
  providers,

  async complete({ messages, tools, maxTokens, temperature }, { purpose, actorUserId = null, background = false } = {}) {
    for (const provider of providers) {
      const blocked = await limiter.tryAcquire({ background });

      if (blocked) {
        await audit(null, { eventType: "LLM_SKIPPED", actorUserId, payload: { provider: provider.name, model: provider.model, purpose, reason: blocked } }).catch(() => {});

        return null;
      }

      const started = now();

      try {
        const result = await provider.chat({ messages, tools, maxTokens, temperature });

        await audit(null, {
          eventType: "LLM_CALL",
          actorUserId,
          payload: { provider: provider.name, model: provider.model, purpose, success: true, latencyMs: now() - started, ...result.usage },
        }).catch(() => {});

        return { ...result, provider: provider.name, model: provider.model, source: `LLM:${provider.name}:${provider.model}` };
      } catch (error) {
        const code = error instanceof LlmError ? error.code : "ERROR";

        await audit(null, {
          eventType: "LLM_CALL",
          actorUserId,
          payload: { provider: provider.name, model: provider.model, purpose, success: false, error: code, latencyMs: now() - started },
        }).catch(() => {});
      }
    }

    return null;
  },
});

const buildFromEnv = (fetchImpl) => {
  const config = env.llm;
  const primary = providerFromConfig(config.provider, config.model, config, fetchImpl);
  const fallback = providerFromConfig(config.fallbackProvider, config.fallbackModel, config, fetchImpl);
  const providers = [primary, fallback].filter(Boolean);

  return createLlmService({
    providers,
    limiter: createRateLimiter({ perMinute: config.ratePerMinute, perDay: config.ratePerDay, callsToday: countCallsToday }),
  });
};

// One shared service built from the environment on first use. Tests replace it.
let shared = null;

const getLlm = () => {
  shared ||= buildFromEnv();

  return shared;
};

const setLlm = (service) => {
  shared = service;
};

module.exports = { createLlmService, createRateLimiter, getLlm, setLlm, buildFromEnv, startOfUtcDay };
