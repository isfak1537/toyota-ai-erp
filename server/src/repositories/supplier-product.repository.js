const prisma = require("../config/prisma");

const supplierProductInclude = {
  supplier: true,
  product: true,
};

const createSupplierProduct = async (data) => {
  return prisma.supplierProduct.create({
    data,
    include: supplierProductInclude,
  });
};

const getAllSupplierProducts = async () => {
  return prisma.supplierProduct.findMany({
    include: supplierProductInclude,
    orderBy: {
      id: "asc",
    },
  });
};

const getSupplierProductById = async (id) => {
  return prisma.supplierProduct.findUnique({
    where: { id },
    include: supplierProductInclude,
  });
};

const updateSupplierProduct = async (id, data) => {
  return prisma.supplierProduct.update({
    where: { id },
    data,
    include: supplierProductInclude,
  });
};

const findBySupplierAndProduct = async (
  supplierId,
  productId
) => {
  return prisma.supplierProduct.findUnique({
    where: {
      supplierId_productId: {
        supplierId,
        productId,
      },
    },
  });
};

const unsetPreferredSuppliers = async (productId, exceptId) => {
  return prisma.supplierProduct.updateMany({
    where: {
      productId,
      id: {
        not: exceptId,
      },
    },
    data: {
      isPreferred: false,
    },
  });
};

module.exports = {
  createSupplierProduct,
  getAllSupplierProducts,
  getSupplierProductById,
  updateSupplierProduct,
  findBySupplierAndProduct,
  unsetPreferredSuppliers,
};