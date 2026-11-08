const supplierService = require("../services/supplier.service");

const createSupplier = async (req, res) => {
  const supplier =
    await supplierService.createSupplier(
      req.body
    );

  res.status(201).json({
    success: true,
    message: "Supplier created successfully",
    data: supplier,
  });
};

const getAllSuppliers = async (req, res) => {
  const suppliers =
    await supplierService.getAllSuppliers();

  res.json({
    success: true,
    data: suppliers,
  });
};

const getSupplierById = async (req, res) => {
  const id = Number(req.params.id);

  const supplier =
    await supplierService.getSupplierById(id);

  res.json({
    success: true,
    data: supplier,
  });
};

const updateSupplier = async (req, res) => {
  const id = Number(req.params.id);

  const supplier =
    await supplierService.updateSupplier(
      id,
      req.body
    );

  res.json({
    success: true,
    message: "Supplier updated successfully",
    data: supplier,
  });
};

const deleteSupplier = async (req, res) => {
  const id = Number(req.params.id);

  await supplierService.deactivateSupplier(id);

  res.json({
    success: true,
    message: "Supplier deactivated successfully",
  });
};

module.exports = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
};