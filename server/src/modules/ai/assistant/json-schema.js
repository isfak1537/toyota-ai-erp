const { z } = require("zod");

// Tool parameters are Zod schemas; the LLM API wants JSON Schema. Zod 4 can produce it directly.
const zodToJsonSchema = (schema) => {
  const { $schema, ...rest } = z.toJSONSchema(schema, { io: "input" });

  return rest;
};

module.exports = { zodToJsonSchema };
