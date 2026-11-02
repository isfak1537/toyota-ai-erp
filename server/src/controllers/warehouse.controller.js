const warehouseService = require("../services/warehouse.service");

const createWarehouse = async (req, res, next) => {
  try {
    const warehouse = await warehouseService.createWarehouse(req.body);

    res.status(201).json({
      success: true,
      message: "Warehouse created successfully",
      data: warehouse,
    });
  } catch (error) {
    next(error);
  }
};

const getAllWarehouses = async (req, res, next) => {
  try {
    const warehouses = await warehouseService.getAllWarehouses();

    res.json({
      success: true,
      data: warehouses,
    });
  } catch (error) {
    next(error);
  }
};

const getWarehouseById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const warehouse = await warehouseService.getWarehouseById(id);

    res.json({
      success: true,
      data: warehouse,
    });
  } catch (error) {
    next(error);
  }
};

const updateWarehouse = async (req, res, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

const deleteWarehouse = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    await warehouseService.deactivateWarehouse(id);

    res.json({
      success: true,
      message: "Warehouse deactivated successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  deleteWarehouse,
};