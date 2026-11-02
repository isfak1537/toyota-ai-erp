const express = require("express");

const validate = require("../middlewares/validate.middleware");

const {
  createFactorySchema,
  updateFactorySchema,
} = require("../validators/factory.validator");

const factoryController = require("../controllers/factory.controller");

const router = express.Router();

router.post(
  "/",
  validate(createFactorySchema),
  factoryController.createFactory
);

router.get("/", factoryController.getAllFactories);

router.get("/:id", factoryController.getFactoryById);

router.patch(
  "/:id",
  validate(updateFactorySchema),
  factoryController.updateFactory
);

router.delete("/:id", factoryController.deleteFactory);

module.exports = router;