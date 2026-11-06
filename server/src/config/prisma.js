require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const env = require("./env");

// DATABASE_URL is the pooled URL on a hosted database (Neon: the "-pooler" host). Migrations use
// DIRECT_DATABASE_URL instead (see prisma.config.ts). Locks in this code are transaction-scoped
// (pg_advisory_xact_lock, SELECT ... FOR UPDATE), which transaction pooling supports.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: env.dbPoolMax,
});

const prisma = new PrismaClient({
  adapter,
});

module.exports = prisma;