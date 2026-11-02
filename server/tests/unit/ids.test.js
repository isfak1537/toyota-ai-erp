const { parseId } = require("../../src/utils/ids");
const { ValidationError } = require("../../src/errors/app-error");

describe("parseId", () => {
  it.each([
    [1, 1],
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ])("accepts %p", (input, expected) => {
    expect(parseId(input)).toBe(expected);
  });

  it.each([0, -1, 1.5, "0", "-3", "1e3", "0x10", " 5 ", "5 ", "", "abc", "1.5", "2147483648", "99999999999", null, undefined, true, [], {}, NaN, Infinity])(
    "rejects %p",
    (input) => {
      expect(() => parseId(input)).toThrow(ValidationError);
    }
  );

  it("uses the supplied message", () => {
    expect(() => parseId("x", "requisitionId must be a valid positive integer")).toThrow(
      "requisitionId must be a valid positive integer"
    );
  });
});
