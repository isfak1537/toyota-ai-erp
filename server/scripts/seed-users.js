// Creates the four demo users (npm run seed:users). Passwords come from
// DEMO_ADMIN_PASSWORD, DEMO_WAREHOUSE_PASSWORD, DEMO_PROCUREMENT_PASSWORD and
// DEMO_VIEWER_PASSWORD in the environment; they are never printed.
// --reset-passwords overwrites the passwords of users that already exist.
require("dotenv").config();

const prisma = require("../src/config/prisma");
const { ensureDemoUsers } = require("../src/services/demo-users");

ensureDemoUsers(process.env, { resetPasswords: process.argv.includes("--reset-passwords") })
  .then((emails) => {
    console.log(`Demo users ready: ${emails.join(", ")}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
