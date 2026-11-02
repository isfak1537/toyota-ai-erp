const express = require("express");

const {
  completeTransfer,
  getAllTransfers,
  getTransferById,
} = require("../controllers/stock-transfer.controller");

const router = express.Router();

router.post("/", completeTransfer);
router.get("/", getAllTransfers);
router.get("/:id", getTransferById);

module.exports = router;