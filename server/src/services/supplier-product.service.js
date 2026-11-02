const prisma = require("../config/prisma");

const supplierProductRepository = require(
  "../repositories/supplier-product.repository"
);

const supplierRepository = require(
  "../repositories/supplier.repository"
);

const productRepository = require(
  "../repositories/product.repository"
);

const createSupplierProduct = async (data) => {
  const supplier = await supplierRepository.getSupplierById(
    data.supplierId
  );

  if (!supplier) {
    const error = new Error("Supplier not found");
    error.statusCode = 404;
    throw error;
  }

  if (!supplier.isActive) {
    const error = new Error(
      "Cannot link an inactive supplier"
    );
    error.statusCode = 400;
    throw error;
  }

  const product = await productRepository.getProductById(
    data.productId
  );

  if (!product) {
    const error = new Error("Product not found");
    error.statusCode = 404;
    throw error;
  }

  if (!product.isActive) {
    const error = new Error(
      "Cannot link an inactive product"
    );
    error.statusCode = 400;
    throw error;
  }

  const existing =
    await supplierProductRepository.findBySupplierAndProduct(
      data.supplierId,
      data.productId
    );

  if (existing) {
    const error = new Error(
      "This supplier is already linked to this product"
    );
    error.statusCode = 409;
    throw error;
  }

  const result =
    await supplierProductRepository.createSupplierProduct(data);

  if (data.isPreferred === true) {
    await supplierProductRepository.unsetPreferredSuppliers(
      data.productId,
      result.id
    );
  }

  return supplierProductRepository.getSupplierProductById(
    result.id
  );
};

const getAllSupplierProducts = async () => {
  return supplierProductRepository.getAllSupplierProducts();
};

const getSupplierProductById = async (id) => {
  const record =
    await supplierProductRepository.getSupplierProductById(id);

  if (!record) {
    const error = new Error(
      "Supplier-product relationship not found"
    );
    error.statusCode = 404;
    throw error;
  }

  return record;
};

const updateSupplierProduct = async (id, data) => {
  const existing = await getSupplierProductById(id);

  if (data.isPreferred === true) {
    await supplierProductRepository.unsetPreferredSuppliers(
      existing.productId,
      id
    );
  }

  return supplierProductRepository.updateSupplierProduct(
    id,
    data
  );
};

module.exports = {
  createSupplierProduct,
  getAllSupplierProducts,
  getSupplierProductById,
  updateSupplierProduct,
};