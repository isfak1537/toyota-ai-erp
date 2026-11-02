const procurementService = require("../services/procurement.service");

const handleError = (res, error) => {
  console.error(error);

  return res.status(400).json({
    success: false,
    message: error.message || "Something went wrong",
  });
};

const createRequisition = async (req, res) => {
  try {
    const data = await procurementService.createRequisition(req.body);

    return res.status(201).json({
      success: true,
      message: "Purchase requisition created successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getRequisitions = async (req, res) => {
  try {
    const data = await procurementService.getRequisitions();

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const submitRequisition = async (req, res) => {
  try {
    const data = await procurementService.submitRequisition(req.params.id);

    return res.json({
      success: true,
      message: "Purchase requisition submitted successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const approveRequisition = async (req, res) => {
  try {
    const data = await procurementService.approveRequisition(req.params.id);

    return res.json({
      success: true,
      message: "Purchase requisition approved successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const createPurchaseOrder = async (req, res) => {
  try {
    const data = await procurementService.createPurchaseOrder(req.body);

    return res.status(201).json({
      success: true,
      message: "Purchase order created successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getPurchaseOrders = async (req, res) => {
  try {
    const data = await procurementService.getPurchaseOrders();

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const approvePurchaseOrder = async (req, res) => {
  try {
    const data = await procurementService.approvePurchaseOrder(req.params.id);

    return res.json({
      success: true,
      message: "Purchase order approved successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const createGoodsReceipt = async (req, res) => {
  try {
    const data = await procurementService.createGoodsReceipt(req.body);

    return res.status(201).json({
      success: true,
      message: "Goods receipt created successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getGoodsReceipts = async (req, res) => {
  try {
    const data = await procurementService.getGoodsReceipts();

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const createPurchaseInvoice = async (req, res) => {
  try {
    const data = await procurementService.createPurchaseInvoice(req.body);

    return res.status(201).json({
      success: true,
      message: "Purchase invoice created successfully",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getPurchaseInvoices = async (req, res) => {
  try {
    const data = await procurementService.getPurchaseInvoices();

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createRequisition,
  getRequisitions,
  submitRequisition,
  approveRequisition,
  createPurchaseOrder,
  getPurchaseOrders,
  approvePurchaseOrder,
  createGoodsReceipt,
  getGoodsReceipts,
  createPurchaseInvoice,
  getPurchaseInvoices,
};