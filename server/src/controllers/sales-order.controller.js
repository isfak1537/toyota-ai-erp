const salesOrderService = require("../services/sales-order.service");

function handleError(res, error) {
  console.error(error);

  const message =
    error?.message || "Internal server error";

  let status = 500;

  if (
    message.includes("not found")
  ) {
    status = 404;
  } else if (
    message.includes("inactive") ||
    message.includes("Duplicate") ||
    message.includes("Only DRAFT") ||
    message.includes("cannot be cancelled") ||
    message.includes("Invalid sales order status") ||
    message.includes("must be")
  ) {
    status = 400;
  } else if (error?.name === "ZodError") {
    status = 400;
  }

  return res.status(status).json({
    success: false,
    message,
  });
}

async function createSalesOrder(req, res) {
  try {
    const salesOrder =
      await salesOrderService.createSalesOrder(
        req.body
      );

    return res.status(201).json({
      success: true,
      message: "Sales order created successfully",
      data: salesOrder,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getAllSalesOrders(req, res) {
  try {
    const salesOrders =
      await salesOrderService.getAllSalesOrders(
        req.query
      );

    return res.json({
      success: true,
      data: salesOrders,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getSalesOrderById(req, res) {
  try {
    const salesOrder =
      await salesOrderService.getSalesOrderById(
        req.params.id
      );

    return res.json({
      success: true,
      data: salesOrder,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function confirmSalesOrder(req, res) {
  try {
    const salesOrder =
      await salesOrderService.confirmSalesOrder(
        req.params.id
      );

    return res.json({
      success: true,
      message: "Sales order confirmed successfully",
      data: salesOrder,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function cancelSalesOrder(req, res) {
  try {
    const salesOrder =
      await salesOrderService.cancelSalesOrder(
        req.params.id
      );

    return res.json({
      success: true,
      message: "Sales order cancelled successfully",
      data: salesOrder,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createSalesOrder,
  getAllSalesOrders,
  getSalesOrderById,
  confirmSalesOrder,
  cancelSalesOrder,
};