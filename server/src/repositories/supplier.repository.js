const prisma = require("../config/prisma");

const createSupplier = async (data) => {
  return prisma.supplier.create({
    data,
    include: {
      products: {
        include: {
          product: true,
        },
      },
    },
  });
};

const getAllSuppliers = async () => {
  return prisma.supplier.findMany({
    include: {
      products: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
};

const getSupplierById = async (id) => {
  return prisma.supplier.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          product: true,
        },
      },
    },
  });
};

const updateSupplier = async (id, data) => {
  return prisma.supplier.update({
    where: { id },
    data,
    include: {
      products: {
        include: {
          product: true,
        },
      },
    },
  });
};

module.exports = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
};