const express = require("express");

const env = require("../config/env");
const { NotFoundError } = require("../errors/app-error");
const authService = require("../services/auth.service");
const demoLoginService = require("../services/demo-login.service");
const validate = require("../middlewares/validate.middleware");
const { authenticate } = require("../middlewares/auth.middleware");
const { createLoginLimiter } = require("../middlewares/login-limiter");
const { loginSchema, demoLoginSchema } = require("../validators/auth.validator");

const router = express.Router();

// A disabled demo login looks like a route that does not exist.
const requireDemoLogin = (req, res, next) => next(env.demoLoginEnabled ? undefined : new NotFoundError("Not found"));

// Four buttons, a few clicks each: more room than a password login, still bounded per address.
const demoLoginLimiter = createLoginLimiter({ max: 30, maxPerAddress: 30 });

router.post("/login", validate(loginSchema), createLoginLimiter(), async (req, res) => {
  const data = await authService.login(req.body);

  res.json({ success: true, data, message: "Logged in", errors: null });
});

router.get("/demo-status", (req, res) => {
  res.json({ success: true, data: { enabled: env.demoLoginEnabled }, message: "OK", errors: null });
});

router.post("/demo-login", requireDemoLogin, validate(demoLoginSchema), demoLoginLimiter, async (req, res) => {
  const data = await demoLoginService.demoLogin(req.body.role);

  res.json({ success: true, data, message: "Logged in", errors: null });
});

router.get("/me", authenticate, (req, res) => {
  res.json({ success: true, data: req.user, message: "OK", errors: null });
});

module.exports = router;
