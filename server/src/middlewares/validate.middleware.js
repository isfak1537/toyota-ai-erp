const { ValidationError } = require("../errors/app-error");

const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.reduce((acc, issue) => {
        const field = issue.path[0];

        if (field) {
          acc[field] = issue.message;
        }

        return acc;
      }, {});

      return next(new ValidationError("Validation failed", details));
    }

    req.body = result.data;

    next();
  };
};

module.exports = validate;
