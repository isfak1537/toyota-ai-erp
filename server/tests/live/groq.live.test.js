// Optional live check against the real Groq API. It runs only when GROQ_API_KEY is set
// (npm run test:live) and uses invented data, never business records. It is not part of `npm test`.
require("dotenv").config({ quiet: true });

const { providerFromConfig } = require("../../src/modules/ai/llm/provider");
const { SYSTEM } = require("../../src/modules/ai/llm/explain");

const key = process.env.GROQ_API_KEY;
const model = process.env.LLM_MODEL || "openai/gpt-oss-120b";
const live = key ? describe : describe.skip;

const config = { groqApiKey: key, geminiApiKey: "", ollamaBaseUrl: "", timeoutMs: 30000 };

live(`Groq live (${model})`, () => {
  const provider = key ? providerFromConfig("groq", model, config) : null;

  it("writes a short explanation that quotes the supplied numbers", async () => {
    const facts = { product: "DEMO-001 Brake Pad Set", availableUnits: 40, reorderPointUnits: 49.9, suggestedOrderQty: 80, leadTimeDays: 4 };

    const out = await provider.chat({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Explain this suggestion.\nFacts (JSON):\n${JSON.stringify(facts)}` },
      ],
      maxTokens: 700,
      temperature: 0.2,
    });

    expect(out.content.length).toBeGreaterThan(20);
    expect(out.content).toMatch(/40/);
    expect(out.content).toMatch(/80/);
  });

  it("calls a read-only tool when asked a question it can answer with one", async () => {
    const tools = [{ type: "function", function: { name: "get_low_stock", description: "List products below their reorder level", parameters: { type: "object", properties: { limit: { type: "integer" } } } } }];

    const out = await provider.chat({ messages: [{ role: "user", content: "Which products are low on stock? Use the tool." }], tools, maxTokens: 400, temperature: 0 });

    expect(out.toolCalls.map((c) => c.name)).toContain("get_low_stock");
  });
});
