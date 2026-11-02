const stockTransferService = require("../services/stock-transfer.service");
const { ValidationError } = require("../errors/app-error");

const parseId = (value) => {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Invalid ID");
  }

  return id;
};

const completeTransfer = async (req, res) => {
  const data = await stockTransferService.completeTransfer({
    fromWarehouseId: Number(req.body.fromWarehouseId),
    toWarehouseId: Number(req.body.toWarehouseId),
    items: req.body.items,
    notes: req.body.notes,
  });

  res.status(201).json({
    success: true,
    message: "Stock transfer completed successfully",
    data,
  });
};

const getAllTransfers = async (req, res) => {
  const data = await stockTransferService.getAllTransfers();

  res.json({
    success: true,
    data,
  });
};

const getTransferById = async (req, res) => {
  const data = await stockTransferService.getTransferById(
    parseId(req.params.id)
  );

  res.json({
    success: true,
    data,
  });
};

module.exports = {
  completeTransfer,
  getAllTransfers,
  getTransferById,
};
