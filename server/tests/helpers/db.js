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
};

const disconnect = async () => {
  await prisma.$disconnect();
};

module.exports = { prisma, resetDatabase, disconnect };
