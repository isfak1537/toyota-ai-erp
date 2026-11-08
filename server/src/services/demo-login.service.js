const prisma = require("../config/prisma");
const { NotFoundError } = require("../errors/app-error");
const { signToken, publicUser } = require("./auth.service");
const { DEMO_USERS } = require("./demo-users");

// Same result as authService.login, without a password: the route is only reachable when
// DEMO_LOGIN_ENABLED=true. Only the seeded demo users can be signed in this way.
const demoLogin = async (role) => {
  const demo = DEMO_USERS.find((u) => u.role === role);
  const user = demo && (await prisma.user.findUnique({ where: { email: demo.email } }));

  if (!user || !user.isActive) {
    throw new NotFoundError("Demo user not found. Run npm run seed:users");
  }

  return { token: signToken(user), user: publicUser(user) };
};

module.exports = { demoLogin };
