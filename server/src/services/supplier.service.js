const supplierRepository = require("../repositories/supplier.repository");

const createSupplier = async (data) => {
  return supplierRepository.createSupplier(data);
};

const getAllSuppliers = async () => {
  return supplierRepository.getAllSuppliers();
};

const getSupplierById = async (id) => {
  const supplier = await supplierRepository.getSupplierById(id);

  if (!supplier) {
    const error = new Error("Supplier not found");
    error.statusCode = 404;
    throw error;
  }

  return supplier;
};

const updateSupplier = async (id, data) => {
  await getSupplierById(id);

  return supplierRepository.updateSupplier(id, data);
};

const deactivateSupplier = async (id) => {
  await getSupplierById(id);

  return supplierRepository.updateSupplier(id, {
    isActive: false,
  });
};

module.exports = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deactivateSupplier,
};