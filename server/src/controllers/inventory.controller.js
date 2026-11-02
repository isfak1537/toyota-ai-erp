const inventoryService = require("../services/inventory.service");
const { parsePagination, toPagination } = require("../utils/pagination");
const { parseId } = require("../utils/ids");
const createInventory = async (req, res) => {
  const data = await inventoryService.createInventory(req.body);

  res.status(201).json({
    success: true,
    message: "Inventory created successfully",
    data,
  });
};

const getAllInventory = async (req, res) => {
  const pagination = parsePagination(req.query);
  const { items, total } = await inventoryService.getAllInventory(pagination);

  res.json({
    success: true,
    data: items,
    pagination: toPagination(pagination, total),
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
  const data = await inventoryService.receiveStock({ ...req.body, actorId: req.user.id });

  res.status(201).json({
    success: true,
    message: "Stock received successfully",
    data,
  });
};

const issueStock = async (req, res) => {
  const data = await inventoryService.issueStock({ ...req.body, actorId: req.user.id });

  res.status(201).json({
    success: true,
    message: "Stock issued successfully",
    data,
  });
};

const adjustStock = async (req, res) => {
  const data = await inventoryService.adjustStock({ ...req.body, actorId: req.user.id });

  res.status(201).json({
    success: true,
    message: "Stock adjusted successfully",
    data,
  });
};

const reserveStock = async (req, res) => {
  const data = await inventoryService.reserveStock({ ...req.body, actorId: req.user.id });

  res.status(201).json({
    success: true,
    message: "Stock reserved successfully",
    data,
  });
};

const releaseStock = async (req, res) => {
  const data = await inventoryService.releaseStock({ ...req.body, actorId: req.user.id });

  res.status(201).json({
    success: true,
    message: "Stock reservation released successfully",
    data,
  });
};

const getTransactions = async (req, res) => {
  const pagination = parsePagination(req.query);
  const { items, total } = await inventoryService.getTransactions({
    productId: req.query.productId,
    warehouseId: req.query.warehouseId,
    type: req.query.type,
    ...pagination,
  });

  res.json({
    success: true,
    data: items,
    pagination: toPagination(pagination, total),
  });
};

const getLowStock = async (req, res) => {
  const pagination = parsePagination(req.query);
  const { items, total } = await inventoryService.getLowStock(pagination);

  res.json({
    success: true,
    count: total,
    data: items,
    pagination: toPagination(pagination, total),
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
