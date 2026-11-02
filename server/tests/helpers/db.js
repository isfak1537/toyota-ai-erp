const prisma = require("../../src/config/prisma");

// Last line of defence: never wipe anything unless the connected database is a
// "_test" database, whatever the environment says.
const assertConnectedToTestDatabase = async () => {
  const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;

  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to truncate: connected database "${name}" does not end in "_test".`
    );
  }
};

// Every test starts with one ADMIN user (id 1, because the reset restarts identities)
// so tests can call the protected API without logging in; see helpers/http.js.
const BASELINE_ADMIN = { id: 1, name: "Baseline Admin", email: "baseline-admin@test.local", role: "ADMIN" };
// bcrypt hash of a throwaway password (cost 4, tests only); nobody logs in as this user.
const BASELINE_HASH = "$2b$04$S8C5/U1fltza0q5loxYBhe1w7HYIeZNn85tapnBnFUgxVfckBDy82";

const resetDatabase = async () => {
  await assertConnectedToTestDatabase();

  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  const list = tables
    .map(({ tablename }) => `"${tablename.replace(/"/g, '""')}"`)
    .join(", ");

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`
  );

  // no explicit id: the sequence (just restarted) hands out 1 and moves on, so later users get 2, 3, ...
  const { id, ...fields } = BASELINE_ADMIN;
  const created = await prisma.user.create({ data: { ...fields, passwordHash: BASELINE_HASH } });

  if (created.id !== id) {
    throw new Error(`Baseline admin got id ${created.id}, expected ${id}`);
  }
};

const disconnect = async () => {
  await prisma.$disconnect();
};

module.exports = { prisma, resetDatabase, disconnect, BASELINE_ADMIN };
