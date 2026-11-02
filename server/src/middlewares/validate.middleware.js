const { ValidationError } = require("../errors/app-error");
const { fieldDetails } = require("../utils/zod-details");

const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      return next(
        new ValidationError("Validation failed", fieldDetails(result.error.issues))
      );
    }

    req.body = result.data;

    next();
  };
};

module.exports = validate;
