const customerService = require("../services/customer.service");

async function createCustomer(req, res) {
  const customer =
    await customerService.createCustomer(req.body);

  return res.status(201).json({
    success: true,
    message: "Customer created successfully",
    data: customer,
  });
}

async function getAllCustomers(req, res) {
  const customers =
    await customerService.getAllCustomers(req.query);

  return res.json({
    success: true,
    data: customers,
  });
}

async function getCustomerById(req, res) {
  const customer =
    await customerService.getCustomerById(req.params.id);

  return res.json({
    success: true,
    data: customer,
  });
}

async function updateCustomer(req, res) {
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
}

async function deactivateCustomer(req, res) {
  const customer =
    await customerService.deactivateCustomer(
      req.params.id
    );

  return res.json({
    success: true,
    message: "Customer deactivated successfully",
    data: customer,
  });
}

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
};