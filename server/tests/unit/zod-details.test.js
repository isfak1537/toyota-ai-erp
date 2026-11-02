const { z } = require("zod");
const { fieldDetails } = require("../../src/utils/zod-details");

const details = (schema, value) => fieldDetails(schema.safeParse(value).error.issues);

describe("fieldDetails", () => {
  const schema = z.strictObject({
    name: z.string("name is required"),
    items: z.array(z.strictObject({ quantity: z.number("quantity must be a number") })),
  });

  it("uses dotted paths for nested fields", () => {
    expect(details(schema, { name: "a", items: [{ quantity: "x" }] })).toEqual({
      "items.0.quantity": "quantity must be a number",
    });
  });

  it("reports unknown keys on the key itself, including nested ones", () => {
    expect(details(schema, { name: "a", extra: 1, items: [{ quantity: 1, price: 2 }] })).toEqual({
      extra: "Unknown field",
      "items.0.price": "Unknown field",
    });
  });

  it("keeps the first message per field", () => {
    const s = z.object({ n: z.string().min(3, "too short").regex(/^a/, "must start with a") });

    expect(details(s, { n: "b" })).toEqual({ n: "too short" });
  });
});
