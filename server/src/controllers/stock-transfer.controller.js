const stockTransferService = require("../services/stock-transfer.service");

const completeTransfer = async (req, res) => {
  try {
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
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllTransfers = async (req, res) => {
  try {
    const data = await stockTransferService.getAllTransfers();

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getTransferById = async (req, res) => {
  try {
    const data = await stockTransferService.getTransferById(
      Number(req.params.id)
    );

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  completeTransfer,
  getAllTransfers,
  getTransferById,
};