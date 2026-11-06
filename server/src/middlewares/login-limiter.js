const { AppError } = require("../errors/app-error");

// Small in-memory brute-force guard for /auth/login. Two budgets per window: at most `max` attempts for
// one client address and email, and at most `maxPerAddress` for one address in total, so trying one
// password against many accounts ("password spraying") is limited too. It resets on restart and is per
// process, which is enough for the MVP; revisit with a shared store when scaling.
const createLoginLimiter = ({ max = 10, maxPerAddress = 30, windowMs = 15 * 60 * 1000, now = Date.now } = {}) => {
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
    const addressKey = String(req.ip);
    const t = now();

    calls += 1;
    if (calls % 100 === 0) sweep(t);

    const recent = (attempts.get(key) || []).filter((at) => t - at < windowMs);
    const fromAddress = (attempts.get(addressKey) || []).filter((at) => t - at < windowMs);

    attempts.set(key, recent);
    attempts.set(addressKey, fromAddress);

    if (recent.length >= max || fromAddress.length >= maxPerAddress) {
      return next(new AppError("Too many login attempts, try again later", 429));
    }

    recent.push(t);
    fromAddress.push(t);

    next();
  };

  middleware.size = () => attempts.size; // for tests

  return middleware;
};

module.exports = { createLoginLimiter };
