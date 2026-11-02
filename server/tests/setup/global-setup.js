const path = require("path");
const { execFileSync } = require("child_process");

const serverDir = path.resolve(__dirname, "../..");

module.exports = async () => {
  require("dotenv").config({ path: path.join(serverDir, ".env"), quiet: true });

  const { assertSafeTestDatabase } = require("./guard");

  assertSafeTestDatabase({
    testUrl: process.env.TEST_DATABASE_URL,
    devUrl: process.env.DATABASE_URL,
  });

  // Apply the committed migrations to the test database only, using the
  // project's local Prisma binary (never a bare npx).
  try {
    execFileSync(
      path.join(serverDir, "node_modules/.bin/prisma"),
      ["migrate", "deploy"],
      {
        cwd: serverDir,
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
        stdio: "pipe",
      }
    );
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`
      .replace(/postgres(ql)?:\/\/\S+/g, "<redacted>");

    throw new Error(`prisma migrate deploy failed on the test database:\n${output}`);
  }
};
