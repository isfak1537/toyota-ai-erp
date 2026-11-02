const procurementService = require("../services/procurement.service");

const createRequisition = async (req, res) => {
  const data = await procurementService.createRequisition(req.body);

  return res.status(201).json({
    success: true,
    message: "Purchase requisition created successfully",
    data,
  });
};

const getRequisitions = async (req, res) => {
  const data = await procurementService.getRequisitions();

  return res.json({
    success: true,
    data,
  });
};

const submitRequisition = async (req, res) => {
  const data = await procurementService.submitRequisition(req.params.id);

  return res.json({
    success: true,
    message: "Purchase requisition submitted successfully",
    data,
  });
};

const approveRequisition = async (req, res) => {
  const data = await procurementService.approveRequisition(req.params.id);

  return res.json({
    success: true,
    message: "Purchase requisition approved successfully",
    data,
  });
};

const createPurchaseOrder = async (req, res) => {
  const data = await procurementService.createPurchaseOrder(req.body);

  return res.status(201).json({
    success: true,
    message: "Purchase order created successfully",
    data,
  });
};

const getPurchaseOrders = async (req, res) => {
  const data = await procurementService.getPurchaseOrders();

  return res.json({
    success: true,
    data,
  });
};

const approvePurchaseOrder = async (req, res) => {
  const data = await procurementService.approvePurchaseOrder(req.params.id);

  return res.json({
    success: true,
    message: "Purchase order approved successfully",
    data,
  });
};

const createGoodsReceipt = async (req, res) => {
  const data = await procurementService.createGoodsReceipt(req.body);

  return res.status(201).json({
    success: true,
    message: "Goods receipt created successfully",
    data,
  });
};

const getGoodsReceipts = async (req, res) => {
  const data = await procurementService.getGoodsReceipts();

  return res.json({
    success: true,
    data,
  });
};

const createPurchaseInvoice = async (req, res) => {
  const data = await procurementService.createPurchaseInvoice(req.body);

  return res.status(201).json({
    success: true,
    message: "Purchase invoice created successfully",
    data,
  });
};

const getPurchaseInvoices = async (req, res) => {
  const data = await procurementService.getPurchaseInvoices();

  return res.json({
    success: true,
    data,
  });
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
