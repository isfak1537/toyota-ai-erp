const { Prisma } = require("@prisma/client");
const { ValidationError } = require("../errors/app-error");

const { Decimal } = Prisma;

const MONEY_DECIMAL_PLACES = 2;

// Parses a money input into a Decimal rounded half-up to 2 places. Never goes
// through JavaScript float arithmetic. null and "" count as 0 (existing
// behaviour); everything else must be a finite, non-negative number.
const toMoney = (value, fieldName = "amount") => {
  let amount;

  if (value === null || value === "") {
    amount = new Decimal(0);
  } else {
    try {
      amount = new Decimal(value);
    } catch {
      throw new ValidationError(`${fieldName} must be a valid non-negative number`);
    }
  }

  if (!amount.isFinite() || amount.lessThan(0)) {
    throw new ValidationError(`${fieldName} must be a valid non-negative number`);
  }

  return amount.toDecimalPlaces(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
};

const lineTotalOf = (quantity, unitPrice) =>
  new Decimal(quantity).times(unitPrice);

// lines: [{ lineTotal: Decimal }]. With 2-place inputs every sum is exact.
const calculateTotals = (lines, taxAmount = 0) => {
  const subtotal = lines.reduce(
    (sum, line) => sum.plus(line.lineTotal),
    new Decimal(0)
  );
  const tax = toMoney(taxAmount, "taxAmount");

  return {
    subtotal,
    taxAmount: tax,
    totalAmount: subtotal.plus(tax),
  };
};

const invoiceStatusFor = (paidAmount, totalAmount) => {
  if (paidAmount.equals(totalAmount)) {
    return "PAID";
  }

  if (paidAmount.greaterThan(0) && paidAmount.lessThan(totalAmount)) {
    return "PARTIALLY_PAID";
  }

  return "UNPAID";
};

module.exports = { toMoney, lineTotalOf, calculateTotals, invoiceStatusFor };
