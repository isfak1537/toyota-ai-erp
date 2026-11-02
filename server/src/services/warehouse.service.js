const warehouseRepository = require("../repositories/warehouse.repository");
const factoryRepository = require("../repositories/factory.repository");

const createWarehouse = async (data) => {
  const factory = await factoryRepository.getFactoryById(data.factoryId);

  if (!factory) {
    const error = new Error("Factory not found");
    error.statusCode = 404;
    throw error;
  }

  if (!factory.isActive) {
    const error = new Error(
      "Cannot create warehouse under an inactive factory"
    );
    error.statusCode = 400;
    throw error;
  }

  if (!factory.company.isActive) {
    const error = new Error(
      "Cannot create warehouse under an inactive company"
    );
    error.statusCode = 400;
    throw error;
  }

  return warehouseRepository.createWarehouse(data);
};

const getAllWarehouses = async () => {
  return warehouseRepository.getAllWarehouses();
};

const getWarehouseById = async (id) => {
  const warehouse = await warehouseRepository.getWarehouseById(id);

  if (!warehouse) {
    const error = new Error("Warehouse not found");
    error.statusCode = 404;
    throw error;
  }

  return warehouse;
};

const updateWarehouse = async (id, data) => {
  await getWarehouseById(id);

  if (data.factoryId !== undefined) {
    const factory = await factoryRepository.getFactoryById(
      data.factoryId
    );

    if (!factory) {
      const error = new Error("Factory not found");
      error.statusCode = 404;
      throw error;
    }

    if (!factory.isActive) {
      const error = new Error(
        "Cannot assign warehouse to an inactive factory"
      );
      error.statusCode = 400;
      throw error;
    }

    if (!factory.company.isActive) {
      const error = new Error(
        "Cannot assign warehouse to an inactive company"
      );
      error.statusCode = 400;
      throw error;
    }
  }

  return warehouseRepository.updateWarehouse(id, data);
};

const deactivateWarehouse = async (id) => {
  await getWarehouseById(id);

  return warehouseRepository.updateWarehouse(id, {
    isActive: false,
  });
};

module.exports = {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  deactivateWarehouse,
};