const { ForbiddenError, UnauthorizedError } = require("../errors/app-error");
const authService = require("../services/auth.service");

// Sets req.user = { id, name, email, role } or rejects with 401.
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const match = /^Bearer (\S+)$/.exec(header);

  if (!match) {
    throw new UnauthorizedError();
  }

  req.user = await authService.findActiveUser(authService.verifyToken(match[1]));

  next();
};

// Use after authenticate. 403 when the user's role is not listed.
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError();
    }

    next();
  };

// Reads (GET, HEAD, OPTIONS) are open to every authenticated role; anything else
// needs one of `roles`. Fails closed: a write route added later is protected too.
const requireRoleForWrites = (...roles) => {
  const guard = requireRole(...roles);

  return (req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ? next() : guard(req, res, next);
};

module.exports = { authenticate, requireRole, requireRoleForWrites };
