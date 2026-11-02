const express = require("express");

const {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
} = require("../controllers/customer.controller");

const router = express.Router();

router.post("/", createCustomer);
router.get("/", getAllCustomers);
router.get("/:id", getCustomerById);
router.patch("/:id", updateCustomer);
router.delete("/:id", deactivateCustomer);

module.exports = router;