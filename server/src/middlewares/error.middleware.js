const { ZodError } = require("zod");
const { AppError } = require("../errors/app-error");

const uniqueViolationMessage = (target) => {
  const fields = Array.isArray(target) ? target : [];

  if (fields.includes("sku")) return "Product SKU already exists";
  if (fields.includes("name")) return "Category name already exists";
  if (fields.includes("code")) return "A record with this code already exists";
  if (fields.includes("email")) return "A record with this email already exists";

  return "A record with the same unique value already exists";
};

const zodDetails = (error) =>
  error.issues.reduce((acc, issue) => {
    const field = issue.path.join(".");

    if (field && !(field in acc)) {
      acc[field] = issue.message;
    }

    return acc;
  }, {});

const errorMiddleware = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const respond = (statusCode, message, errors) => {
    const body = { success: false, message };

    if (errors && Object.keys(errors).length > 0) {
      body.errors = errors;
    }

    return res.status(statusCode).json(body);
  };

  if (err instanceof AppError) {
    return respond(err.statusCode, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return respond(400, "Validation failed", zodDetails(err));
  }

  if (err?.code === "P2002") {
    return respond(409, uniqueViolationMessage(err.meta?.target));
  }

  if (err?.code === "P2025") {
    return respond(404, "Record not found");
  }

  if (err?.type === "entity.parse.failed") {
    return respond(400, "Malformed JSON body");
  }

  // Legacy modules (product, category, ...) still set statusCode/details on a
  // plain Error. Remove this branch once they throw AppError subclasses.
  if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
    return respond(err.statusCode, err.message, err.details);
  }

  console.error(err);

  return respond(500, "Internal server error");
};

module.exports = errorMiddleware;
