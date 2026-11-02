const prisma = require("../config/prisma");

const inventoryInclude = {
  product: true,
  warehouse: {
    include: {
      factory: true,
    },
  },
};

const findInventoryByProductAndWarehouse = async (
  productId,
  warehouseId
) => {
  return prisma.inventory.findUnique({
    where: {
      productId_warehouseId: {
        productId,
        warehouseId,
      },
    },
    include: inventoryInclude,
  });
};

const createInventory = async (data) => {
  return prisma.inventory.create({
    data,
    include: inventoryInclude,
  });
};

const getAllInventory = async () => {
  return prisma.inventory.findMany({
    include: inventoryInclude,
    orderBy: {
      id: "asc",
    },
  });
};

const getInventoryById = async (id) => {
  return prisma.inventory.findUnique({
    where: { id },
    include: inventoryInclude,
  });
};

const updateInventory = async (id, data) => {
  return prisma.inventory.update({
    where: { id },
    data,
    include: inventoryInclude,
  });
};

const deleteInventory = async (id) => {
  return prisma.inventory.delete({
    where: { id },
  });
};

module.exports = {
  findInventoryByProductAndWarehouse,
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  deleteInventory,
};