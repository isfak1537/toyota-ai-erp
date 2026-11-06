const { suggestionFacts, systemFor, SYSTEM, SUGGESTION_RULES } = require("../../src/modules/ai/llm/explain");

// Air Filter case: need 57 units, supplier minimum 80, so the order is raised to 80 (AI-009).
const suggestion = (over = {}) => ({
  product: { sku: "SYN-ENG-002", name: "Air Filter" },
  warehouse: { code: "MAIN" },
  supplier: { name: "Acme Parts" },
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
  ...over,
});

describe("suggestionFacts (AI-009)", () => {
  it("states the trigger, the calculated need and that the minimum order quantity was binding", () => {
    const facts = suggestionFacts(suggestion());

    expect(facts).toMatchObject({
      trigger: "available stock is below the AI reorder point",
      availableUnits: 20,
      reorderPointUnits: 34.7,
      calculatedNeedUnits: 57,
      minimumOrderQty: 80,
      minimumOrderQtyWasBindingConstraint: true,
      orderQtyUnits: 80,
    });
  });

  it("says the minimum was not binding when the need is already above it", () => {
    const facts = suggestionFacts(suggestion({ suggestedQty: 120, inputs: { rawQty: 120, outcome: "SUGGEST" } }));

    expect(facts.calculatedNeedUnits).toBe(120);
    expect(facts.minimumOrderQtyWasBindingConstraint).toBe(false);
    expect(facts.orderQtyUnits).toBe(120);
  });

  it("gives the model no order-quantity field named like a stock level, so the two cannot be mistaken for each other", () => {
    const keys = Object.keys(suggestionFacts(suggestion()));

    expect(keys).not.toContain("suggestedOrderQty");
    expect(keys.filter((k) => /reorder/i.test(k))).toEqual(["reorderPointUnits"]);
    expect(keys.filter((k) => /order.?qty/i.test(k) && /reorder/i.test(k))).toEqual([]);
  });
});

describe("suggestion prompt (AI-009)", () => {
  it("asks for the trigger, the calculated need and the binding constraint, and forbids comparing order quantity with reorder point", () => {
    const prompt = systemFor("suggestion");

    expect(prompt).toContain(SUGGESTION_RULES);
    expect(prompt).toMatch(/available stock is below the AI reorder point/);
    expect(prompt).toMatch(/calculated need/);
    expect(prompt).toMatch(/minimum order quantity was the binding constraint/);
    expect(prompt).toMatch(/never compare the order quantity with the reorder point/);
  });

  it("keeps the rules out of other explanations", () => {
    expect(systemFor("anomaly flag")).toBe(SYSTEM);
  });
});
