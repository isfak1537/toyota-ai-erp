const { ValidationError } = require("../errors/app-error");

const MAX_ID = 2_147_483_647; // Postgres Int

// Accepts a positive integer or a string of digits only. Number() alone would
// also accept "1e3", "0x10" and " 5 ".
const parseId = (value, message = "Invalid ID") => {
  let id = Number.NaN;

  if (typeof value === "number") {
    id = value;
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    id = Number(value);
  }

  if (!Number.isInteger(id) || id <= 0 || id > MAX_ID) {
    throw new ValidationError(message);
  }

  return id;
};

module.exports = { parseId };
