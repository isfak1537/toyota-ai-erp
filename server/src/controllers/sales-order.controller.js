const salesOrderService = require("../services/sales-order.service");

async function createSalesOrder(req, res) {
  const salesOrder =
    await salesOrderService.createSalesOrder(
      req.body
    );

  return res.status(201).json({
    success: true,
    message: "Sales order created successfully",
    data: salesOrder,
  });
}

async function getAllSalesOrders(req, res) {
  const salesOrders =
    await salesOrderService.getAllSalesOrders(
      req.query
    );

  return res.json({
    success: true,
    data: salesOrders,
  });
}

async function getSalesOrderById(req, res) {
  const salesOrder =
    await salesOrderService.getSalesOrderById(
      req.params.id
    );

  return res.json({
    success: true,
    data: salesOrder,
  });
}

async function confirmSalesOrder(req, res) {
  const salesOrder =
    await salesOrderService.confirmSalesOrder(
      req.params.id
    );

  return res.json({
    success: true,
    message: "Sales order confirmed successfully",
    data: salesOrder,
  });
}

async function cancelSalesOrder(req, res) {
  const salesOrder =
    await salesOrderService.cancelSalesOrder(
      req.params.id
    );

  return res.json({
    success: true,
    message: "Sales order cancelled successfully",
    data: salesOrder,
  });
}

module.exports = {
  createSalesOrder,
  getAllSalesOrders,
  getSalesOrderById,
  confirmSalesOrder,
  cancelSalesOrder,
};