const { NotFoundError, ValidationError } = require("../errors/app-error");
const warehouseRepository = require("../repositories/warehouse.repository");
const factoryRepository = require("../repositories/factory.repository");

const createWarehouse = async (data) => {
  const factory = await factoryRepository.getFactoryById(data.factoryId);

  if (!factory) {
    throw new NotFoundError("Factory not found");
  }

  if (!factory.isActive) {
    throw new ValidationError(
      "Cannot create warehouse under an inactive factory"
    );
  }

  if (!factory.company.isActive) {
    throw new ValidationError(
      "Cannot create warehouse under an inactive company"
    );
  }

  return warehouseRepository.createWarehouse(data);
};

const getAllWarehouses = async () => {
  return warehouseRepository.getAllWarehouses();
};

const getWarehouseById = async (id) => {
  const warehouse = await warehouseRepository.getWarehouseById(id);

  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
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
      throw new NotFoundError("Factory not found");
    }

    if (!factory.isActive) {
      throw new ValidationError(
        "Cannot assign warehouse to an inactive factory"
      );
    }

    if (!factory.company.isActive) {
      throw new ValidationError(
        "Cannot assign warehouse to an inactive company"
      );
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