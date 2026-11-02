const prisma = require("../config/prisma");

const createCompany = async (data) => {
  return prisma.company.create({
    data,
  });
};

const getAllCompanies = async () => {
  return prisma.company.findMany({
    include: {
      factories: {
        include: {
          warehouses: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
};

const getCompanyById = async (id) => {
  return prisma.company.findUnique({
    where: { id },
    include: {
      factories: {
        include: {
          warehouses: true,
        },
      },
    },
  });
};

const updateCompany = async (id, data) => {
  return prisma.company.update({
    where: { id },
    data,
  });
};

module.exports = {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
};