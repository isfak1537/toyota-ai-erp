const prisma = require("../config/prisma");
const { hashPassword } = require("./auth.service");

const MIN_PASSWORD_LENGTH = 12;

const DEMO_USERS = [
  { env: "DEMO_ADMIN_PASSWORD", name: "Demo Admin", email: "admin@demo.synthetic", role: "ADMIN" },
  { env: "DEMO_WAREHOUSE_PASSWORD", name: "Demo Warehouse Manager", email: "warehouse@demo.synthetic", role: "WAREHOUSE_MANAGER" },
  { env: "DEMO_PROCUREMENT_PASSWORD", name: "Demo Procurement Officer", email: "procurement@demo.synthetic", role: "PROCUREMENT_OFFICER" },
  { env: "DEMO_VIEWER_PASSWORD", name: "Demo Viewer", email: "viewer@demo.synthetic", role: "VIEWER" },
];

// Creates the four demo users. Passwords come only from the environment (never
// hard-coded, never logged). An existing user keeps its password unless
// `resetPasswords` is set. Returns the emails created or updated.
const ensureDemoUsers = async (environment = process.env, { resetPasswords = false } = {}) => {
  const missing = DEMO_USERS.filter(
    (u) => !environment[u.env] || environment[u.env].length < MIN_PASSWORD_LENGTH
  ).map((u) => u.env);

  if (missing.length) {
    throw new Error(
      `Set ${missing.join(", ")} to passwords of at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }

  const done = [];

  for (const u of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });

    if (existing && !resetPasswords) {
      await prisma.user.update({ where: { id: existing.id }, data: { name: u.name, role: u.role, isActive: true } });
    } else {
      const passwordHash = await hashPassword(environment[u.env]);

      await prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, isActive: true, passwordHash },
        create: { name: u.name, email: u.email, role: u.role, passwordHash },
      });
    }

    done.push(u.email);
  }

  return done;
};

module.exports = { ensureDemoUsers, DEMO_USERS, MIN_PASSWORD_LENGTH };
