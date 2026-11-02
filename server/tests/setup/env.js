// Runs in every integration test worker before any application module loads.
// Points the app's Prisma client at the test database and nothing else.
const path = require("path");

process.env.DOTENV_CONFIG_QUIET = "true";

require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const { assertSafeTestDatabase } = require("./guard");

assertSafeTestDatabase({
  testUrl: process.env.TEST_DATABASE_URL,
  devUrl: process.env.DATABASE_URL,
});

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";

// A fixed value for tests only; real secrets come from the environment.
process.env.JWT_SECRET = "test-only-jwt-secret-0123456789abcdef0123456789";

// Tests never reach a real AI service or LLM, whatever the developer's .env says.
process.env.AI_SERVICE_URL = "http://127.0.0.1:9";
process.env.AI_SERVICE_SECRET = "test-only-ai-service-secret-0123456789";
process.env.LLM_PROVIDER = "";
process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
