const errorMiddleware = (err, req, res, next) => {
  console.error(err);

  /*
  |--------------------------------------------------------------------------
  | Prisma Unique Constraint Error
  |--------------------------------------------------------------------------
  */

  if (err.code === "P2002") {
    const target = err.meta?.target;

    let message =
      "A record with the same unique value already exists";

    if (Array.isArray(target)) {
      if (target.includes("sku")) {
        message = "Product SKU already exists";
      } else if (target.includes("name")) {
        message = "Category name already exists";
      } else if (target.includes("code")) {
        message = "A record with this code already exists";
      } else if (target.includes("email")) {
        message = "A record with this email already exists";
      }
    }

    return res.status(409).json({
      success: false,
      message,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | General Application Errors
  |--------------------------------------------------------------------------
  */

  const statusCode = err.statusCode || 500;

  const response = {
    success: false,
    message:
      err.message || "Internal server error",
  };

  if (err.details) {
    response.errors = err.details;
  }

  res.status(statusCode).json(response);
};

module.exports = errorMiddleware;