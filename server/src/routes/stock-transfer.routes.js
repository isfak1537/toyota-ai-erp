const express = require("express");

const {
  completeTransfer,
  getAllTransfers,
  getTransferById,
} = require("../controllers/stock-transfer.controller");

const validate = require("../middlewares/validate.middleware");
const { completeTransferSchema } = require("../validators/stock-transfer.validator");

const router = express.Router();

router.post("/", validate(completeTransferSchema), completeTransfer);
router.get("/", getAllTransfers);
router.get("/:id", getTransferById);

module.exports = router;