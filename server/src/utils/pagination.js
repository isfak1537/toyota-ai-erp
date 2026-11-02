const { z } = require("zod");
const { ValidationError } = require("../errors/app-error");
const { fieldDetails } = require("./zod-details");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1_000_000;

const queryInt = (label, fallback, max) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === "") {
        return fallback;
      }

      return typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
    },
    z
      .number({ error: `${label} must be a positive integer` })
      .int(`${label} must be a positive integer`)
      .min(1, `${label} must be a positive integer`)
      .max(max, `${label} must be at most ${max}`)
  );

const paginationSchema = z.object({
  page: queryInt("page", 1, MAX_PAGE),
  pageSize: queryInt("pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
});

// Reads ?page and ?pageSize (?limit is accepted as an alias of pageSize for
// older callers). Out-of-range values are a 400, not silently clamped.
const parsePagination = (query = {}) => {
  const result = paginationSchema.safeParse({
    page: query.page,
    pageSize: query.pageSize ?? query.limit,
  });

  if (!result.success) {
    throw new ValidationError(
      "Invalid pagination parameters",
      fieldDetails(result.error.issues)
    );
  }

  const { page, pageSize } = result.data;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

const toPagination = ({ page, pageSize }, total) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});

module.exports = { parsePagination, toPagination, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
