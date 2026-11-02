const warehouseService = require("../services/warehouse.service");

const createWarehouse = async (req, res) => {
  const warehouse = await warehouseService.createWarehouse(req.body);

  res.status(201).json({
    success: true,
    message: "Warehouse created successfully",
    data: warehouse,
  });
};

const getAllWarehouses = async (req, res) => {
  const warehouses = await warehouseService.getAllWarehouses();

  res.json({
    success: true,
    data: warehouses,
  });
};

const getWarehouseById = async (req, res) => {
  const id = Number(req.params.id);

  const warehouse = await warehouseService.getWarehouseById(id);

  res.json({
    success: true,
    data: warehouse,
  });
};

const updateWarehouse = async (req, res) => {
  const id = Number(req.params.id);

  const warehouse = await warehouseService.updateWarehouse(
    id,
    req.body
  );

  res.json({
    success: true,
    message: "Warehouse updated successfully",
    data: warehouse,
  });
};

const deleteWarehouse = async (req, res) => {
  const id = Number(req.params.id);

  await warehouseService.deactivateWarehouse(id);

  res.json({
    success: true,
    message: "Warehouse deactivated successfully",
  });
};

module.exports = {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  deleteWarehouse,
};