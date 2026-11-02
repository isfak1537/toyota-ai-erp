const { ConflictError, NotFoundError, ValidationError } = require("../errors/app-error");
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
    throw new NotFoundError("Supplier not found");
  }

  if (!supplier.isActive) {
    throw new ValidationError(
      "Cannot link an inactive supplier"
    );
  }

  const product = await productRepository.getProductById(
    data.productId
  );

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  if (!product.isActive) {
    throw new ValidationError(
      "Cannot link an inactive product"
    );
  }

  const existing =
    await supplierProductRepository.findBySupplierAndProduct(
      data.supplierId,
      data.productId
    );

  if (existing) {
    throw new ConflictError(
      "This supplier is already linked to this product"
    );
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
    throw new NotFoundError(
      "Supplier-product relationship not found"
    );
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