const express = require("express");

const controller = require("../controllers/ai.controller");
const validate = require("../middlewares/validate.middleware");
const { requireRole } = require("../middlewares/auth.middleware");
const roles = require("../middlewares/roles");
const { runReplenishmentSchema } = require("../validators/ai.validator");

const router = express.Router();

// Reads are open to every authenticated role; each write names its roles.
router.post("/replenishment/run", requireRole(...roles.PROCUREMENT), validate(runReplenishmentSchema), controller.runReplenishment);
router.get("/suggestions", controller.listSuggestions);

module.exports = router;
