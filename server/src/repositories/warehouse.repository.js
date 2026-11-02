const prisma = require("../config/prisma");

const createWarehouse = async (data) => {
  return prisma.warehouse.create({
    data,
    include: {
      factory: {
        include: {
          company: true,
        },
      },
    },
  });
};

const getAllWarehouses = async () => {
  return prisma.warehouse.findMany({
    include: {
      factory: {
        include: {
          company: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
};

const getWarehouseById = async (id) => {
  return prisma.warehouse.findUnique({
    where: { id },
    include: {
      factory: {
        include: {
          company: true,
        },
      },
    },
  });
};

const updateWarehouse = async (id, data) => {
  return prisma.warehouse.update({
    where: { id },
    data,
    include: {
      factory: {
        include: {
          company: true,
        },
      },
    },
  });
};

module.exports = {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
};