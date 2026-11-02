const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const prisma = require("../config/prisma");
const { UnauthorizedError } = require("../errors/app-error");

const BCRYPT_ROUNDS = 10;

// Compared when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

const ROLES = ["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER", "VIEWER"];

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

const signToken = (user) =>
  jwt.sign({ role: user.role }, env.jwtSecret, {
    subject: String(user.id),
    expiresIn: env.jwtExpiresIn,
    algorithm: "HS256",
  });

// Returns the token's user id, or throws UnauthorizedError.
const verifyToken = (token) => {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    const id = Number(payload.sub);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("bad subject");
    }

    return id;
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
};

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  // Same message for an unknown email, a wrong password and an inactive user.
  if (!user || !ok || !user.isActive) {
    throw new UnauthorizedError("Invalid email or password");
  }

  return { token: signToken(user), user: publicUser(user) };
};

// The user as stored now, so a deactivation or role change takes effect immediately.
const findActiveUser = async (id) => {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("Invalid or expired token");
  }

  return publicUser(user);
};

module.exports = {
  ROLES,
  hashPassword,
  signToken,
  verifyToken,
  login,
  findActiveUser,
  publicUser,
};
