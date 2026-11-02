const prisma = require("../config/prisma");

const createCategory = async (data) => {
  return prisma.category.create({
    data,
  });
};

const getAllCategories = async () => {
  return prisma.category.findMany({
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });
};

const getCategoryById = async (id) => {
  return prisma.category.findUnique({
    where: {
      id,
    },
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
  });
};

const updateCategory = async (id, data) => {
  return prisma.category.update({
    where: {
      id,
    },
    data,
  });
};

const deleteCategory = async (id) => {
  return prisma.category.delete({
    where: {
      id,
    },
  });
};

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};