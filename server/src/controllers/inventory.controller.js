const inventoryService = require("../services/inventory.service");
const { ValidationError } = require("../errors/app-error");

const parseId = (value) => {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Invalid ID");
  }

  return id;
};

const createInventory = async (req, res) => {
  const data = await inventoryService.createInventory({
    ...req.body,
    productId: parseId(req.body.productId),
    warehouseId: parseId(req.body.warehouseId),
  });

  res.status(201).json({
    success: true,
    message: "Inventory created successfully",
    data,
  });
};

const getAllInventory = async (req, res) => {
  const data = await inventoryService.getAllInventory();

  res.json({
    success: true,
    data,
  });
};

const getInventoryById = async (req, res) => {
  const data = await inventoryService.getInventoryById(
    parseId(req.params.id)
  );

  res.json({
    success: true,
    data,
  });
};

const updateInventory = async (req, res) => {
  const data = await inventoryService.updateInventory(
    parseId(req.params.id),
    req.body
  );

  res.json({
    success: true,
    message: "Inventory updated successfully",
    data,
  });
};

const deleteInventory = async (req, res) => {
  await inventoryService.deleteInventory(
    parseId(req.params.id)
  );

  res.json({
    success: true,
    message: "Inventory deleted successfully",
  });
};

const receiveStock = async (req, res) => {
  const data = await inventoryService.receiveStock({
    ...req.body,
    productId: parseId(req.body.productId),
    warehouseId: parseId(req.body.warehouseId),
    quantity: Number(req.body.quantity),
    referenceId: req.body.referenceId
      ? Number(req.body.referenceId)
      : undefined,
  });

  res.status(201).json({
    success: true,
    message: "Stock received successfully",
    data,
  });
};

const issueStock = async (req, res) => {
  const data = await inventoryService.issueStock({
    ...req.body,
    productId: parseId(req.body.productId),
    warehouseId: parseId(req.body.warehouseId),
    quantity: Number(req.body.quantity),
    referenceId: req.body.referenceId
      ? Number(req.body.referenceId)
      : undefined,
  });

  res.status(201).json({
    success: true,
    message: "Stock issued successfully",
    data,
  });
};

const adjustStock = async (req, res) => {
  const data = await inventoryService.adjustStock({
    ...req.body,
    productId: parseId(req.body.productId),
    warehouseId: parseId(req.body.warehouseId),
    quantity: Number(req.body.quantity),
    referenceId: req.body.referenceId
      ? Number(req.body.referenceId)
      : undefined,
  });

  res.status(201).json({
    success: true,
    message: "Stock adjusted successfully",
    data,
  });
};

const reserveStock = async (req, res) => {
  const data = await inventoryService.reserveStock({
    ...req.body,
    productId: parseId(req.body.productId),
    warehouseId: parseId(req.body.warehouseId),
    quantity: Number(req.body.quantity),
    referenceId: req.body.referenceId
      ? Number(req.body.referenceId)
      : undefined,
  });

  res.status(201).json({
    success: true,
    message: "Stock reserved successfully",
    data,
  });
};

const releaseStock = async (req, res) => {
  const data = await inventoryService.releaseStock({
    ...req.body,
    productId: parseId(req.body.productId),
    warehouseId: parseId(req.body.warehouseId),
    quantity: Number(req.body.quantity),
    referenceId: req.body.referenceId
      ? Number(req.body.referenceId)
      : undefined,
  });

  res.status(201).json({
    success: true,
    message: "Stock reservation released successfully",
    data,
  });
};

const getTransactions = async (req, res) => {
  const data = await inventoryService.getTransactions({
    productId: req.query.productId,
    warehouseId: req.query.warehouseId,
    type: req.query.type,
    limit: req.query.limit,
  });

  res.json({
    success: true,
    data,
  });
};

const getLowStock = async (req, res) => {
  const data = await inventoryService.getLowStock();

  res.json({
    success: true,
    count: data.length,
    data,
  });
};

module.exports = {
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  deleteInventory,
  receiveStock,
  issueStock,
  adjustStock,
  reserveStock,
  releaseStock,
  getTransactions,
  getLowStock,
};
