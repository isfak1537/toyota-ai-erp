const stockTransferService = require("../services/stock-transfer.service");
const { parsePagination, toPagination } = require("../utils/pagination");
const { ValidationError } = require("../errors/app-error");

const parseId = (value) => {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Invalid ID");
  }

  return id;
};

const completeTransfer = async (req, res) => {
  const data = await stockTransferService.completeTransfer(req.body);

  res.status(201).json({
    success: true,
    message: "Stock transfer completed successfully",
    data,
  });
};

const getAllTransfers = async (req, res) => {
  const pagination = parsePagination(req.query);
  const { items, total } = await stockTransferService.getAllTransfers(pagination);

  res.json({
    success: true,
    data: items,
    pagination: toPagination(pagination, total),
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
