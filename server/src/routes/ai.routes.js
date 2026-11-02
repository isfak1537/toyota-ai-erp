const express = require("express");

const controller = require("../controllers/ai.controller");
const validate = require("../middlewares/validate.middleware");
const { requireRole } = require("../middlewares/auth.middleware");
const roles = require("../middlewares/roles");
const { runReplenishmentSchema, approveSuggestionSchema, rejectSuggestionSchema, syncAnomaliesSchema, reviewAnomalySchema, retrainSchema } = require("../validators/ai.validator");

const router = express.Router();

// Reads are open to every authenticated role; each write names its roles.
router.post("/replenishment/run", requireRole(...roles.PROCUREMENT), validate(runReplenishmentSchema), controller.runReplenishment);
router.get("/suggestions", controller.listSuggestions);
router.post("/suggestions/:id/explain", requireRole(...roles.PROCUREMENT), validate(approveSuggestionSchema), controller.explainSuggestion);
router.post("/suggestions/:id/approve", requireRole(...roles.PROCUREMENT), validate(approveSuggestionSchema), controller.approveSuggestion);
router.post("/suggestions/:id/reject", requireRole(...roles.PROCUREMENT), validate(rejectSuggestionSchema), controller.rejectSuggestion);

router.post("/anomalies/sync", requireRole(...roles.ANOMALY_REVIEW), validate(syncAnomaliesSchema), controller.syncAnomalies);
router.get("/anomalies", controller.listAnomalies);
router.post("/anomalies/:id/explain", requireRole(...roles.ANOMALY_REVIEW), validate(approveSuggestionSchema), controller.explainAnomaly);
router.post("/anomalies/:id/review", requireRole(...roles.ANOMALY_REVIEW), validate(reviewAnomalySchema), controller.reviewAnomaly);

router.get("/forecast/:productId", controller.productForecast);
router.get("/models", controller.listModels);
router.post("/models/retrain", requireRole(...roles.ADMIN_ONLY), validate(retrainSchema), controller.retrainModels);

module.exports = router;
