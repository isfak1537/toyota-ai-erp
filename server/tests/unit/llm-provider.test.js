const { createProvider, providerFromConfig, LlmError } = require("../../src/modules/ai/llm/provider");
const { createLlmService, createRateLimiter } = require("../../src/modules/ai/llm/llm.service");

const KEY = "sk-unit-test-key-must-never-leak";

const reply = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const completion = (message, usage = { prompt_tokens: 11, completion_tokens: 7 }) => ({ choices: [{ message }], usage });

const provider = (fetchImpl, extra = {}) =>
  createProvider({ name: "groq", baseUrl: "https://llm.example/v1", apiKey: KEY, model: "m-1", timeoutMs: 200, fetchImpl, ...extra });

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("expected a rejection");
};

describe("provider.chat", () => {
  it("posts an OpenAI-style request with the bearer key and returns content and usage", async () => {
    let seen;
    const p = provider(async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };

      return { ok: true, status: 200, json: async () => completion({ content: "  Short answer.  " }) };
    });

    const out = await p.chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 50, temperature: 0 });

    expect(out).toEqual({ content: "Short answer.", toolCalls: [], usage: { promptTokens: 11, completionTokens: 7 } });
    expect(seen.url).toBe("https://llm.example/v1/chat/completions");
    expect(seen.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen.body).toMatchObject({ model: "m-1", max_tokens: 50, temperature: 0, messages: [{ role: "user", content: "hi" }] });
    expect(seen.body.tools).toBeUndefined();
  });

  it("sends tools and parses tool calls with their JSON arguments", async () => {
    let body;
    const p = provider(async (url, init) => {
      body = JSON.parse(init.body);

      return { ok: true, status: 200, json: async () => completion({ content: null, tool_calls: [{ id: "c1", function: { name: "get_low_stock", arguments: '{"limit":5}' } }] }) };
    });

    const out = await p.chat({ messages: [], tools: [{ type: "function", function: { name: "get_low_stock" } }] });

    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
    expect(out.toolCalls).toEqual([{ id: "c1", name: "get_low_stock", arguments: { limit: 5 } }]);
  });

  it("maps failures to short codes that never contain the key", async () => {
    const codes = {
      HTTP_429: provider(reply({ error: `rate limited for ${KEY}` }, 429)),
      HTTP_500: provider(reply({}, 500)),
      BAD_RESPONSE: provider(reply({ nothing: true })),
      EMPTY: provider(reply(completion({ content: "   " }))),
      BAD_TOOL_ARGUMENTS: provider(reply(completion({ content: "", tool_calls: [{ id: "x", function: { name: "t", arguments: "{oops" } }] }))),
      NETWORK: provider(async () => {
        throw new TypeError(`fetch failed ${KEY}`);
      }),
      TIMEOUT: provider((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))),
    };

    for (const [code, p] of Object.entries(codes)) {
      const error = await failure(p.chat({ messages: [] }));

      expect(error).toBeInstanceOf(LlmError);
      expect(error.code).toBe(code);
      expect(`${error.message} ${error.stack}`).not.toContain(KEY);
    }
  });

  it("a body that is not JSON is a bad response", async () => {
    const p = provider(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } }));

    expect((await failure(p.chat({ messages: [] }))).code).toBe("BAD_RESPONSE");
  });
});

describe("providerFromConfig", () => {
  const config = { groqApiKey: "g", geminiApiKey: "", ollamaBaseUrl: "http://localhost:11434", timeoutMs: 1000 };

  it("needs a name, a model and (except Ollama) a key", () => {
    expect(providerFromConfig("groq", "openai/gpt-oss-120b", config)).toMatchObject({ name: "groq", model: "openai/gpt-oss-120b" });
    expect(providerFromConfig("groq", "", config)).toBeNull();
    expect(providerFromConfig("", "m", config)).toBeNull();
    expect(providerFromConfig("gemini", "gemini-x", config)).toBeNull();
    expect(providerFromConfig("gemini", "gemini-x", { ...config, geminiApiKey: "k" })).toMatchObject({ name: "gemini" });
    expect(providerFromConfig("ollama", "llama3", config)).toMatchObject({ name: "ollama" });
    expect(providerFromConfig("openai", "gpt", config)).toBeNull();
  });

  it("uses the right endpoint, sends low reasoning effort to gpt-oss only, and no auth header for Ollama", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });

      return { ok: true, status: 200, json: async () => completion({ content: "ok" }) };
    };

    await providerFromConfig("groq", "openai/gpt-oss-20b", config, fetchImpl).chat({ messages: [] });
    await providerFromConfig("groq", "other/model", config, fetchImpl).chat({ messages: [] });
    await providerFromConfig("gemini", "gemini-x", { ...config, geminiApiKey: "k" }, fetchImpl).chat({ messages: [] });
    await providerFromConfig("ollama", "llama3", config, fetchImpl).chat({ messages: [] });

    expect(calls.map((c) => c.url)).toEqual([
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "http://localhost:11434/v1/chat/completions",
    ]);
    expect(calls[0].body.reasoning_effort).toBe("low");
    expect(calls[1].body.reasoning_effort).toBeUndefined();
    expect(calls[2].body.reasoning_effort).toBeUndefined();
    expect(calls[3].headers.Authorization).toBeUndefined();
  });
});

describe("rate limiter", () => {
  it("allows perMinute calls in a sliding minute, then recovers", async () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 2, perDay: 100, now: () => t, callsToday: async () => 0 });

    expect([await limiter.tryAcquire(), await limiter.tryAcquire(), await limiter.tryAcquire()]).toEqual([null, null, "RATE_PER_MINUTE"]);

    t = 59_999;
    expect(await limiter.tryAcquire()).toBe("RATE_PER_MINUTE");
    t = 60_000;
    expect(await limiter.tryAcquire()).toBeNull();
  });

  it("stops at the daily cap, counted from the audit log", async () => {
    let today = 799;
    const limiter = createRateLimiter({ perMinute: 100, perDay: 800, callsToday: async () => today });

    expect(await limiter.tryAcquire()).toBeNull();
    today = 800;
    expect(await limiter.tryAcquire()).toBe("RATE_PER_DAY");
  });

  it("a refused call does not use up the minute budget", async () => {
    const limiter = createRateLimiter({ perMinute: 1, perDay: 0.5, callsToday: async () => 1 });

    expect(await limiter.tryAcquire()).toBe("RATE_PER_DAY");
    expect(await limiter.tryAcquire()).toBe("RATE_PER_DAY"); // still the day cap, not the minute cap
  });
});

describe("llm service", () => {
  const fake = (name, behaviour) => ({ name, model: `${name}-model`, chat: behaviour });
  const open = { tryAcquire: async () => null };
  const record = () => {
    const events = [];

    return { events, audit: async (client, event) => events.push(event) };
  };

  it("returns the first provider's answer with its source and audits the call without the prompt", async () => {
    const { events, audit } = record();
    const llm = createLlmService({ providers: [fake("groq", async () => ({ content: "hello", toolCalls: [], usage: { promptTokens: 3, completionTokens: 2 } }))], limiter: open, audit });

    const out = await llm.complete({ messages: [{ role: "user", content: "SECRET PROMPT TEXT" }] }, { purpose: "explain_suggestion", actorUserId: 5 });

    expect(out).toMatchObject({ content: "hello", source: "LLM:groq:groq-model" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "LLM_CALL", actorUserId: 5, payload: { provider: "groq", model: "groq-model", purpose: "explain_suggestion", success: true, promptTokens: 3 } });
    expect(JSON.stringify(events)).not.toContain("SECRET PROMPT TEXT");
  });

  it("falls back to the next provider when the first fails, and audits both attempts", async () => {
    const { events, audit } = record();
    const llm = createLlmService({
      providers: [fake("groq", async () => { throw new LlmError("HTTP_429"); }), fake("gemini", async () => ({ content: "from fallback", toolCalls: [], usage: {} }))],
      limiter: open,
      audit,
    });

    const out = await llm.complete({ messages: [] }, { purpose: "p" });

    expect(out.source).toBe("LLM:gemini:gemini-model");
    expect(events.map((e) => [e.payload.provider, e.payload.success, e.payload.error])).toEqual([["groq", false, "HTTP_429"], ["gemini", true, undefined]]);
  });

  it("returns null, never throws, when every provider fails; an unexpected error counts as ERROR", async () => {
    const { events, audit } = record();
    const llm = createLlmService({ providers: [fake("groq", async () => { throw new Error("boom with a key sk-123"); })], limiter: open, audit });

    expect(await llm.complete({ messages: [] }, { purpose: "p" })).toBeNull();
    expect(events[0].payload.error).toBe("ERROR");
    expect(JSON.stringify(events)).not.toContain("sk-123");
  });

  it("returns null and logs LLM_SKIPPED when over quota, without calling a provider", async () => {
    const { events, audit } = record();
    let called = false;
    const llm = createLlmService({ providers: [fake("groq", async () => { called = true; })], limiter: { tryAcquire: async () => "RATE_PER_DAY" }, audit });

    expect(await llm.complete({ messages: [] }, { purpose: "p" })).toBeNull();
    expect(called).toBe(false);
    expect(events).toEqual([expect.objectContaining({ eventType: "LLM_SKIPPED", payload: expect.objectContaining({ reason: "RATE_PER_DAY" }) })]);
  });

  it("with no providers it is disabled and answers null", async () => {
    const llm = createLlmService({ providers: [], limiter: open, audit: async () => {} });

    expect(llm.enabled).toBe(false);
    expect(await llm.complete({ messages: [] }, { purpose: "p" })).toBeNull();
  });

  it("an audit failure does not break the call", async () => {
    const llm = createLlmService({ providers: [fake("groq", async () => ({ content: "fine", toolCalls: [], usage: {} }))], limiter: open, audit: async () => { throw new Error("db down"); } });

    expect((await llm.complete({ messages: [] }, { purpose: "p" })).content).toBe("fine");
  });
});
