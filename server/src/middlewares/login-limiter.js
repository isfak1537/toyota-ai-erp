const { AppError } = require("../errors/app-error");

// Small in-memory brute-force guard for /auth/login: at most `max` attempts per
// `windowMs` for one client address and email. It resets on restart and is per
// process, which is enough for the MVP; revisit with a shared store when scaling.
const createLoginLimiter = ({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) => {
  const attempts = new Map();

  return (req, res, next) => {
    const key = `${req.ip}|${String(req.body?.email || "").toLowerCase()}`;
    const t = now();
    const recent = (attempts.get(key) || []).filter((at) => t - at < windowMs);

    if (recent.length >= max) {
      attempts.set(key, recent);

      return next(new AppError("Too many login attempts, try again later", 429));
    }

    recent.push(t);
    attempts.set(key, recent);

    next();
  };
};

module.exports = { createLoginLimiter };
