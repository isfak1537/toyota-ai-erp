// Safety guard for integration tests. Pure over two connection strings so it
// can be unit-tested. It never includes a URL (or credentials) in its messages.

const target = (url) => {
  const parsed = new URL(url);

  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
};

const assertSafeTestDatabase = ({ testUrl, devUrl }) => {
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests refuse to run without a dedicated test database."
    );
  }

  let test;

  try {
    test = target(testUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid connection URL.");
  }

  if (!test.database.endsWith("_test")) {
    throw new Error(
      `Refusing to run: the test database name must end in "_test" (got "${test.database}").`
    );
  }

  if (devUrl) {
    let dev = null;

    try {
      dev = target(devUrl);
    } catch {
      // An unparsable DATABASE_URL cannot be the same database.
    }

    if (
      testUrl === devUrl ||
      (dev &&
        dev.host === test.host &&
        dev.port === test.port &&
        dev.database === test.database)
    ) {
      throw new Error(
        "Refusing to run: TEST_DATABASE_URL points at the same database as DATABASE_URL."
      );
    }
  }

  return test;
};

module.exports = { assertSafeTestDatabase, target };
