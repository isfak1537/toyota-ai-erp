const customerService = require("../services/customer.service");

function handleError(res, error) {
  console.error(error);

  const message =
    error?.message || "Internal server error";

  let status = 500;

  if (message.includes("not found")) {
    status = 404;
  } else if (message.includes("already exists")) {
    status = 409;
  } else if (
    message.includes("must be") ||
    message.includes("isActive") ||
    error?.name === "ZodError"
  ) {
    status = 400;
  }

  return res.status(status).json({
    success: false,
    message,
  });
}

async function createCustomer(req, res) {
  try {
    const customer =
      await customerService.createCustomer(req.body);

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: customer,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getAllCustomers(req, res) {
  try {
    const customers =
      await customerService.getAllCustomers(req.query);

    return res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getCustomerById(req, res) {
  try {
    const customer =
      await customerService.getCustomerById(req.params.id);

    return res.json({
      success: true,
      data: customer,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateCustomer(req, res) {
  try {
    const customer =
      await customerService.updateCustomer(
        req.params.id,
        req.body
      );

    return res.json({
      success: true,
      message: "Customer updated successfully",
      data: customer,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deactivateCustomer(req, res) {
  try {
    const customer =
      await customerService.deactivateCustomer(
        req.params.id
      );

    return res.json({
      success: true,
      message: "Customer deactivated successfully",
      data: customer,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
};