const { Prisma } = require("@prisma/client");
const {
  toMoney,
  lineTotalOf,
  calculateTotals,
  invoiceStatusFor,
} = require("../../src/utils/money");
const { ValidationError } = require("../../src/errors/app-error");

const { Decimal } = Prisma;
const d = (value) => new Decimal(value);

describe("toMoney", () => {
  it("parses numbers and strings into Decimals", () => {
    expect(toMoney(12.34).equals("12.34")).toBe(true);
    expect(toMoney("12.34").equals("12.34")).toBe(true);
    expect(toMoney(0).equals(0)).toBe(true);
  });

  it("treats null and empty string as zero (existing behaviour)", () => {
    expect(toMoney(null).equals(0)).toBe(true);
    expect(toMoney("").equals(0)).toBe(true);
  });

  it("rounds half-up to 2 places, unlike toFixed on binary floats", () => {
    expect((1.005).toFixed(2)).toBe("1.00"); // the float bug being avoided
    expect(toMoney(1.005).equals("1.01")).toBe(true);
    expect(toMoney(2.675).equals("2.68")).toBe(true);
    expect(toMoney("0.125").equals("0.13")).toBe(true);
    expect(toMoney("0.124").equals("0.12")).toBe(true);
  });

  it.each([-1, "-0.01", "abc", NaN, Infinity, undefined, true, {}])(
    "rejects %p",
    (value) => {
      expect(() => toMoney(value, "price")).toThrow(ValidationError);
    }
  );

  it("names the field in the error message", () => {
    expect(() => toMoney(-1, "unitPrice")).toThrow(
      "unitPrice must be a valid non-negative number"
    );
  });
});

describe("decimal arithmetic", () => {
  it("0.1 + 0.2 is exactly 0.3 (floats give 0.30000000000000004)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);

    const { subtotal, totalAmount } = calculateTotals([
      { lineTotal: toMoney(0.1) },
      { lineTotal: toMoney(0.2) },
    ]);

    expect(subtotal.equals("0.3")).toBe(true);
    expect(totalAmount.equals("0.3")).toBe(true);
  });

  it("3 x 0.10 is exactly 0.30", () => {
    expect(3 * 0.1).not.toBe(0.3);
    expect(lineTotalOf(3, toMoney(0.1)).equals("0.3")).toBe(true);
  });

  it("adds tax exactly: 3 x 19.99 + 0.07", () => {
    const line = lineTotalOf(3, toMoney(19.99));
    const totals = calculateTotals([{ lineTotal: line }], 0.07);

    expect(line.equals("59.97")).toBe(true);
    expect(totals.subtotal.equals("59.97")).toBe(true);
    expect(totals.taxAmount.equals("0.07")).toBe(true);
    expect(totals.totalAmount.equals("60.04")).toBe(true);
  });

  it("defaults tax to zero and validates it", () => {
    expect(calculateTotals([{ lineTotal: d(5) }]).totalAmount.equals(5)).toBe(true);
    expect(() => calculateTotals([{ lineTotal: d(5) }], -1)).toThrow(
      "taxAmount must be a valid non-negative number"
    );
  });

  it("keeps full precision on large amounts", () => {
    const line = lineTotalOf(1000, toMoney(9999999.99));
    const { totalAmount } = calculateTotals([{ lineTotal: line }], 0.01);

    expect(line.equals("9999999990")).toBe(true);
    expect(totalAmount.equals("9999999990.01")).toBe(true);
  });

  it("returns Decimal instances, never JavaScript numbers", () => {
    const totals = calculateTotals([{ lineTotal: d("1.1") }], 2.2);

    expect(Decimal.isDecimal(totals.subtotal)).toBe(true);
    expect(Decimal.isDecimal(totals.taxAmount)).toBe(true);
    expect(Decimal.isDecimal(totals.totalAmount)).toBe(true);
  });
});

describe("invoiceStatusFor", () => {
  it("is UNPAID, PARTIALLY_PAID or PAID", () => {
    expect(invoiceStatusFor(d(0), d("0.3"))).toBe("UNPAID");
    expect(invoiceStatusFor(d("0.1"), d("0.3"))).toBe("PARTIALLY_PAID");
    expect(invoiceStatusFor(d("0.3"), d("0.3"))).toBe("PAID");
  });

  it("compares by value, not representation", () => {
    expect(invoiceStatusFor(d("0.30"), d("0.3"))).toBe("PAID");
    expect(invoiceStatusFor(d("0.1").plus("0.2"), d("0.3"))).toBe("PAID");
  });
});
