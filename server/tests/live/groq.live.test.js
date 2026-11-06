// Optional live check against the real Groq API. It runs only when GROQ_API_KEY is set
// (npm run test:live) and uses invented data, never business records. It is not part of `npm test`.
require("dotenv").config({ quiet: true });

const { providerFromConfig } = require("../../src/modules/ai/llm/provider");
const { suggestionFacts, systemFor } = require("../../src/modules/ai/llm/explain");

const key = process.env.GROQ_API_KEY;
const model = process.env.LLM_MODEL || "openai/gpt-oss-120b";
const live = key ? describe : describe.skip;

const config = { groqApiKey: key, geminiApiKey: "", ollamaBaseUrl: "", timeoutMs: 30000 };

live(`Groq live (${model})`, () => {
  const provider = key ? providerFromConfig("groq", model, config) : null;

  it("explains a suggestion: trigger, calculated need, binding minimum, no order-quantity vs reorder-point comparison", async () => {
    const facts = suggestionFacts({
      product: { sku: "DEMO-001", name: "Air Filter" },
      warehouse: { code: "DEMO" },
      supplier: { name: "Demo Supplier" },
      available: 20,
      onOrder: 0,
      onOrderMethod: "NONE",
      forecastDaily: 4.2,
      sigma: 1.1,
      leadTimeDays: 7,
      reviewDays: 7,
      safetyStock: 5.3,
      reorderPoint: 34.7,
      minimumOrderQty: 80,
      suggestedQty: 80,
      forecastModel: "ML",
      inputs: { rawQty: 57, outcome: "SUGGEST_MOQ" },
    });

    const out = await provider.chat({
      messages: [
        { role: "system", content: systemFor("suggestion") },
        { role: "user", content: `Explain this suggestion.\nFacts (JSON):\n${JSON.stringify(facts)}` },
      ],
      maxTokens: 700,
      temperature: 0.2,
    });

    expect(out.content).toMatch(/57/);
    expect(out.content).toMatch(/80/);
    expect(out.content).toMatch(/minimum/i);
    // the order quantity (80) and the reorder point (34.7) must not be set against each other
    expect(out.content).not.toMatch(/80[^.]*(above|exceed|more than|greater than|higher than|larger than)[^.]*34\.7/i);
    expect(out.content).not.toMatch(/34\.7[^.]*(below|less than|under|lower than|smaller than)[^.]*80/i);
  });

  it("calls a read-only tool when asked a question it can answer with one", async () => {
    const tools = [{ type: "function", function: { name: "get_low_stock", description: "List products below their reorder level", parameters: { type: "object", properties: { limit: { type: "integer" } } } } }];

    const out = await provider.chat({ messages: [{ role: "user", content: "Which products are low on stock? Use the tool." }], tools, maxTokens: 400, temperature: 0 });

    expect(out.toolCalls.map((c) => c.name)).toContain("get_low_stock");
  });
});
