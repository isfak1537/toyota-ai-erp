const supplierService = require("../services/supplier.service");

const createSupplier = async (req, res, next) => {
  try {
    const supplier =
      await supplierService.createSupplier(
        req.body
      );

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    next(error);
  }
};

const getAllSuppliers = async (req, res, next) => {
  try {
    const suppliers =
      await supplierService.getAllSuppliers();

    res.json({
      success: true,
      data: suppliers,
    });
  } catch (error) {
    next(error);
  }
};

const getSupplierById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const supplier =
      await supplierService.getSupplierById(id);

    res.json({
      success: true,
      data: supplier,
    });
  } catch (error) {
    next(error);
  }
};

const updateSupplier = async (req, res, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

const deleteSupplier = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    await supplierService.deleteSupplier(id);

    res.json({
      success: true,
      message: "Supplier deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
};