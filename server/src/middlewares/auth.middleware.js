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

module.exports = { authenticate, requireRole };
