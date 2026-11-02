const express = require("express");

const validate = require("../middlewares/validate.middleware");

const {
  createCompanySchema,
  updateCompanySchema,
} = require("../validators/company.validator");

const companyController = require("../controllers/company.controller");

const router = express.Router();

router.post(
  "/",
  validate(createCompanySchema),
  companyController.createCompany
);

router.get("/", companyController.getAllCompanies);

router.get("/:id", companyController.getCompanyById);

router.patch(
  "/:id",
  validate(updateCompanySchema),
  companyController.updateCompany
);

router.delete("/:id", companyController.deleteCompany);

module.exports = router;