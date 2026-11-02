require("dotenv").config();

// Values are read when first used, not when this file loads, so tests and
// scripts can set them after requiring the module. Secrets only ever come from
// the environment; nothing here has a usable default for a secret.
const MIN_JWT_SECRET_LENGTH = 32;

const env = {
  port: Number(process.env.PORT) || 5001,
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",

  get jwtSecret() {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be set to at least ${MIN_JWT_SECRET_LENGTH} characters`
      );
    }

    return secret;
  },

  // AI service (read lazily so the ERP starts and works without it)
  get aiServiceUrl() {
    return process.env.AI_SERVICE_URL || "http://localhost:8000";
  },

  get aiServiceSecret() {
    return process.env.AI_SERVICE_SECRET || "";
  },

  get aiTimeoutMs() {
    return Number(process.env.AI_TIMEOUT_MS) || 15000;
  },

  get aiTrainTimeoutMs() {
    return Number(process.env.AI_TRAIN_TIMEOUT_MS) || 120000;
  },

  // Replenishment defaults (SRS 15, decided 2 Nov 2026): z 1.65 (about a 95% service level), 7-day review
  get replenishmentZ() {
    const z = Number(process.env.REPLEN_Z);

    return Number.isFinite(z) && z > 0 ? z : 1.65;
  },

  get replenishmentReviewDays() {
    const days = Number(process.env.REPLEN_REVIEW_DAYS);

    return Number.isInteger(days) && days >= 0 ? days : 7;
  },

  // LLM (AI-009, AI-012). Empty LLM_PROVIDER switches the LLM off; every feature then works without it.
  get llm() {
    const number = (name, fallback) => {
      const value = Number(process.env[name]);

      return Number.isFinite(value) && value > 0 ? value : fallback;
    };

    return {
      provider: (process.env.LLM_PROVIDER || "").trim().toLowerCase(),
      model: (process.env.LLM_MODEL || "").trim(),
      fallbackProvider: (process.env.LLM_FALLBACK_PROVIDER || "").trim().toLowerCase(),
      fallbackModel: (process.env.LLM_FALLBACK_MODEL || "").trim(),
      groqApiKey: process.env.GROQ_API_KEY || "",
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, ""),
      timeoutMs: number("LLM_TIMEOUT_MS", 15000),
      // below the Groq free tier on purpose (NFR-015)
      ratePerMinute: number("LLM_RATE_PER_MINUTE", 20),
      ratePerDay: number("LLM_RATE_PER_DAY", 800),
    };
  },

  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN || "8h";
  },
};

module.exports = env;
