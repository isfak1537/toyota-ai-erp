const prisma = require("../config/prisma");

const createFactory = async (data) => {
  return prisma.factory.create({
    data,
    include: {
      company: true,
      warehouses: true,
    },
  });
};

const getAllFactories = async () => {
  return prisma.factory.findMany({
    include: {
      company: true,
      warehouses: true,
    },
    orderBy: {
      name: "asc",
    },
  });
};

const getFactoryById = async (id) => {
  return prisma.factory.findUnique({
    where: { id },
    include: {
      company: true,
      warehouses: true,
    },
  });
};

const updateFactory = async (id, data) => {
  return prisma.factory.update({
    where: { id },
    data,
    include: {
      company: true,
      warehouses: true,
    },
  });
};

module.exports = {
  createFactory,
  getAllFactories,
  getFactoryById,
  updateFactory,
};