const prisma = require("../config/prisma");

const productInclude = {
  category: true,
  suppliers: {
    include: {
      supplier: true,
    },
  },
};

const createProduct = async (data) => {
  return prisma.product.create({
    data,
    include: productInclude,
  });
};

const getAllProducts = async ({
  skip,
  take,
  search,
  isActive,
  sortBy,
  sortOrder,
}) => {
  const where = {};

  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        sku: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        barcode: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  const allowedSortFields = {
    name: "name",
    price: "price",
    createdAt: "createdAt",
    reorderLevel: "reorderLevel",
  };

  const orderBy = {
    [allowedSortFields[sortBy] || "createdAt"]:
      sortOrder === "asc" ? "asc" : "desc",
  };

  return prisma.product.findMany({
    skip,
    take,
    where,
    include: productInclude,
    orderBy,
  });
};

const countProducts = async ({ search, isActive }) => {
  const where = {};

  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        sku: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        barcode: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  return prisma.product.count({ where });
};

const getProductById = async (id) => {
  return prisma.product.findUnique({
    where: { id },
    include: productInclude,
  });
};

const updateProduct = async (id, data) => {
  return prisma.product.update({
    where: { id },
    data,
    include: productInclude,
  });
};

module.exports = {
  createProduct,
  getAllProducts,
  countProducts,
  getProductById,
  updateProduct,
};