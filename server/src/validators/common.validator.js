const { z } = require("zod");

// Upper bounds keep values inside the database column types (Int, Decimal).
const MAX_QUANTITY = 100_000_000;
const MAX_UNIT_PRICE = 9_999_999_999.99; // Decimal(12,2)
const MAX_AMOUNT = 999_999_999_999.99; // Decimal(14,2)

// JSON clients sometimes send ids and quantities as numeric strings; accept
// them (the controllers used to coerce with Number()).
const numericInput = (value) =>
  typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value;

const positiveInt = (label, max = 2_147_483_647) =>
  z.preprocess(
    numericInput,
    z
      .number({ error: `${label} must be a positive integer` })
      .int(`${label} must be a positive integer`)
      .positive(`${label} must be a positive integer`)
      .max(max, `${label} is too large`)
  );

const quantity = (label = "quantity") => positiveInt(label, MAX_QUANTITY);

const nonNegativeInt = (label, max = MAX_QUANTITY) =>
  z.preprocess(
    numericInput,
    z
      .number({ error: `${label} must be a non-negative integer` })
      .int(`${label} must be a non-negative integer`)
      .min(0, `${label} cannot be negative`)
      .max(max, `${label} is too large`)
  );

const nonZeroInt = (label) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value,
    z
      .number({ error: `${label} must be a non-zero integer` })
      .int(`${label} must be a non-zero integer`)
      .refine((value) => value !== 0, `${label} must be a non-zero integer`)
      .refine((value) => Math.abs(value) <= MAX_QUANTITY, `${label} is too large`)
  );

// Optional id: absent, null and "" all mean "not provided".
const optionalId = (label) =>
  z.preprocess(
    (value) => (value === "" ? null : value),
    positiveInt(label).nullable().optional()
  );

// Validates a money input and returns it as a decimal string, so the exact
// digits the client sent reach the Decimal arithmetic in utils/money.js.
const money = (label, max = MAX_AMOUNT) => {
  const message = `${label} must be a valid non-negative number`;

  return z.preprocess(
    (value) => {
      if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : value;
      }

      return typeof value === "string" ? value.trim() : value;
    },
    z
      .string({ error: message })
      .regex(/^\d+(\.\d+)?$/, { error: message, abort: true })
      .refine((value) => Number(value) <= max, `${label} is too large`)
  );
};

const optionalMoney = (label) =>
  z.preprocess((value) => (value === "" ? null : value), money(label).nullable().optional());

const text = (label, max = 1000) =>
  z.string({ error: `${label} must be text` }).trim().max(max, `${label} is too long`);

const optionalText = (label, max = 1000) =>
  z.preprocess((value) => (value === "" ? null : value), text(label, max).nullable().optional());

const optionalDate = (label) =>
  z.preprocess(
    (value) => (value === "" ? null : value),
    z
      .string({ error: `${label} must be a valid date` })
      .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be a valid date`)
      .nullable()
      .optional()
  );

// Adds an issue on `items` when the same productId appears twice.
const uniqueProducts = (message) => (data, ctx) => {
  const seen = new Set();

  for (const item of data.items) {
    if (seen.has(item.productId)) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: message(item.productId),
      });
      return;
    }

    seen.add(item.productId);
  }
};

module.exports = {
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  MAX_AMOUNT,
  positiveInt,
  quantity,
  nonNegativeInt,
  nonZeroInt,
  optionalId,
  money,
  optionalMoney,
  text,
  optionalText,
  optionalDate,
  uniqueProducts,
};
