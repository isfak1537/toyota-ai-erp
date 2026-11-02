const { assertSafeTestDatabase } = require("../setup/guard");

const dev = "postgresql://user:secret@localhost:5432/toyota_erp?schema=public";
const test = "postgresql://user:secret@localhost:5432/toyota_erp_test?schema=public";

describe("test database guard", () => {
  it("accepts a separate *_test database", () => {
    expect(assertSafeTestDatabase({ testUrl: test, devUrl: dev })).toEqual({
      host: "localhost",
      port: "5432",
      database: "toyota_erp_test",
    });
  });

  it("aborts when TEST_DATABASE_URL is missing", () => {
    expect(() => assertSafeTestDatabase({ testUrl: undefined, devUrl: dev })).toThrow(
      /TEST_DATABASE_URL is not set/
    );
  });

  it("aborts when the test URL equals DATABASE_URL", () => {
    expect(() =>
      assertSafeTestDatabase({
        testUrl: "postgresql://u:p@localhost:5432/app_test",
        devUrl: "postgresql://u:p@localhost:5432/app_test",
      })
    ).toThrow(/same database/);
  });

  it("aborts when both point at the same database with different credentials", () => {
    expect(() =>
      assertSafeTestDatabase({
        testUrl: "postgresql://a:x@localhost:5432/app_test",
        devUrl: "postgresql://b:y@LOCALHOST:5432/app_test",
      })
    ).toThrow(/same database/);
  });

  it("aborts when the database name does not end in _test", () => {
    expect(() =>
      assertSafeTestDatabase({
        testUrl: "postgresql://u:p@localhost:5432/toyota_erp",
        devUrl: "postgresql://u:p@localhost:5432/other",
      })
    ).toThrow(/must end in "_test"/);
  });

  it("aborts on an invalid URL", () => {
    expect(() => assertSafeTestDatabase({ testUrl: "not a url", devUrl: dev })).toThrow(
      /not a valid connection URL/
    );
  });

  it("never puts credentials in an error message", () => {
    try {
      assertSafeTestDatabase({ testUrl: dev, devUrl: dev });
    } catch (error) {
      expect(error.message).not.toMatch(/secret|user:/);
      return;
    }

    throw new Error("expected the guard to throw");
  });
});
