const { AppError } = require("../errors/app-error");

// Small in-memory brute-force guard for /auth/login: at most `max` attempts per
// `windowMs` for one client address and email. It resets on restart and is per
// process, which is enough for the MVP; revisit with a shared store when scaling.
const createLoginLimiter = ({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) => {
  const attempts = new Map();
  let calls = 0;

  // Without this the map would keep one entry for every address and email ever seen.
  const sweep = (t) => {
    for (const [key, times] of attempts) {
      if (times.every((at) => t - at >= windowMs)) attempts.delete(key);
    }
  };

  const middleware = (req, res, next) => {
    const key = `${req.ip}|${String(req.body?.email || "").toLowerCase()}`;
    const t = now();

    calls += 1;
    if (calls % 100 === 0) sweep(t);

    const recent = (attempts.get(key) || []).filter((at) => t - at < windowMs);

    if (recent.length >= max) {
      attempts.set(key, recent);

      return next(new AppError("Too many login attempts, try again later", 429));
    }

    recent.push(t);
    attempts.set(key, recent);

    next();
  };

  middleware.size = () => attempts.size; // for tests

  return middleware;
};

module.exports = { createLoginLimiter };
