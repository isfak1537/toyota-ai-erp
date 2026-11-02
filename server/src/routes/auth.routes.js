const express = require("express");

const authService = require("../services/auth.service");
const validate = require("../middlewares/validate.middleware");
const { authenticate } = require("../middlewares/auth.middleware");
const { createLoginLimiter } = require("../middlewares/login-limiter");
const { loginSchema } = require("../validators/auth.validator");

const router = express.Router();

router.post("/login", validate(loginSchema), createLoginLimiter(), async (req, res) => {
  const data = await authService.login(req.body);

  res.json({ success: true, data, message: "Logged in", errors: null });
});

router.get("/me", authenticate, (req, res) => {
  res.json({ success: true, data: req.user, message: "OK", errors: null });
});

module.exports = router;
