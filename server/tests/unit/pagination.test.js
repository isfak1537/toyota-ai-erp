const { parsePagination, toPagination } = require("../../src/utils/pagination");
const { ValidationError } = require("../../src/errors/app-error");

describe("parsePagination", () => {
  it("defaults to page 1 and pageSize 20", () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
    expect(parsePagination(undefined)).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it("parses numeric strings and computes skip", () => {
    expect(parsePagination({ page: "3", pageSize: "25" })).toEqual({
      page: 3,
      pageSize: 25,
      skip: 50,
      take: 25,
    });
  });

  it("accepts limit as an alias of pageSize, pageSize wins", () => {
    expect(parsePagination({ limit: "10" }).pageSize).toBe(10);
    expect(parsePagination({ limit: "10", pageSize: "5" }).pageSize).toBe(5);
  });

  it("allows exactly 100 and rejects 101", () => {
    expect(parsePagination({ pageSize: "100" }).take).toBe(100);
    expect(() => parsePagination({ pageSize: "101" })).toThrow(ValidationError);
  });

  it.each([
    [{ page: "0" }, "page"],
    [{ page: "-1" }, "page"],
    [{ page: "1.5" }, "page"],
    [{ page: "abc" }, "page"],
    [{ page: ["1", "2"] }, "page"],
    [{ pageSize: "0" }, "pageSize"],
    [{ pageSize: "1e3" }, "pageSize"],
    [{ pageSize: "9999" }, "pageSize"],
  ])("rejects %j with a detail on %s", (query, field) => {
    try {
      parsePagination(query);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys(error.details)).toEqual([field]);
      return;
    }

    throw new Error("expected a ValidationError");
  });
});

describe("toPagination", () => {
  it("computes totalPages", () => {
    expect(toPagination({ page: 2, pageSize: 20 }, 41)).toEqual({
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(toPagination({ page: 1, pageSize: 20 }, 0).totalPages).toBe(0);
    expect(toPagination({ page: 1, pageSize: 20 }, 20).totalPages).toBe(1);
  });
});
