// OpenAI-compatible chat providers (AI-012): Groq, Gemini and Ollama all speak the same
// /chat/completions protocol, so one small client covers them. Failures are LlmError with a short
// machine code; messages never contain the API key, request headers or response bodies.

class LlmError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "LlmError";
    this.code = code;
  }
}

const ENDPOINTS = {
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const MAX_TEXT = 1200;

const createProvider = ({ name, baseUrl, apiKey = "", model, timeoutMs = 15000, extraBody = {}, fetchImpl = (...args) => fetch(...args) }) => ({
  name,
  model,

  // messages: [{role, content, ...}]; tools: OpenAI function tool definitions (optional).
  // Returns { content, toolCalls, usage } where toolCalls is [{ id, name, arguments (parsed object) }].
  async chat({ messages, tools, maxTokens = 800, temperature = 0.2 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(tools?.length && { tools, tool_choice: "auto" }),
          ...extraBody,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new LlmError(error?.name === "AbortError" ? "TIMEOUT" : "NETWORK");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new LlmError(`HTTP_${response.status}`);
    }

    let body;

    try {
      body = await response.json();
    } catch {
      throw new LlmError("BAD_RESPONSE");
    }

    const message = body?.choices?.[0]?.message;

    if (!message || typeof message !== "object") {
      throw new LlmError("BAD_RESPONSE");
    }

    const toolCalls = (message.tool_calls || []).map((call) => {
      let args = {};

      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        throw new LlmError("BAD_TOOL_ARGUMENTS");
      }

      return { id: call.id, name: call.function?.name, arguments: args };
    });

    const content = typeof message.content === "string" ? message.content.trim().slice(0, MAX_TEXT) : "";

    if (!content && toolCalls.length === 0) {
      throw new LlmError("EMPTY");
    }

    return {
      content,
      toolCalls,
      usage: { promptTokens: body.usage?.prompt_tokens ?? null, completionTokens: body.usage?.completion_tokens ?? null },
    };
  },
});

// Builds the provider for one configured name, or null when it cannot work (no key, no model).
const providerFromConfig = (name, model, config, fetchImpl) => {
  if (!name || !model) return null;

  const common = { name, model, timeoutMs: config.timeoutMs, fetchImpl };

  if (name === "groq") {
    if (!config.groqApiKey) return null;

    // gpt-oss models spend completion tokens on reasoning; keep it short for explanations
    const extraBody = model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {};

    return createProvider({ ...common, baseUrl: ENDPOINTS.groq, apiKey: config.groqApiKey, extraBody });
  }

  if (name === "gemini") {
    return config.geminiApiKey ? createProvider({ ...common, baseUrl: ENDPOINTS.gemini, apiKey: config.geminiApiKey }) : null;
  }

  if (name === "ollama") {
    return createProvider({ ...common, baseUrl: `${config.ollamaBaseUrl}/v1` });
  }

  return null;
};

module.exports = { LlmError, createProvider, providerFromConfig, ENDPOINTS };
