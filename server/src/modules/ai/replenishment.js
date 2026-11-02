// Pure replenishment maths (AI-004). No database, no I/O: units are plain numbers
// (only money uses Decimal in this codebase).
//
//   SS  = z * sigma * sqrt(L)                       safety stock
//   ROP = d * L + SS                                reorder point
//   if available <= ROP:
//     qty = max(MOQ, ceil(d * (L + review) + SS - available - onOrder))
//
// A suggestion is only made when the stock still needs covering after the open
// orders (the ceil() term is above zero); otherwise the shortfall is already on order.

// ceil() on a float sum can turn 12.000000000000002 into 13; six decimals is far
// below the precision of a demand forecast.
const ceilSafe = (value) => Math.ceil(Math.round(value * 1e6) / 1e6);

const computeReplenishment = ({
  dailyMean,
  sigma,
  leadTimeDays,
  minimumOrderQty,
  available,
  onOrder,
  z,
  reviewDays,
}) => {
  const safetyStock = z * sigma * Math.sqrt(leadTimeDays);
  const reorderPoint = dailyMean * leadTimeDays + safetyStock;
  const belowReorderPoint = available <= reorderPoint;
  const required = dailyMean * (leadTimeDays + reviewDays) + safetyStock - available - onOrder;
  const rawQty = ceilSafe(required);

  let suggestedQty = null;
  let outcome = "NOT_NEEDED";

  if (belowReorderPoint && rawQty > 0) {
    suggestedQty = Math.max(minimumOrderQty, rawQty);
    outcome = suggestedQty > rawQty ? "SUGGEST_MOQ" : "SUGGEST";
  } else if (belowReorderPoint) {
    // the open orders swallow the whole need (otherwise nothing was needed at all)
    outcome = ceilSafe(required + onOrder) > 0 ? "COVERED_BY_ON_ORDER" : "NOT_NEEDED";
  }

  return { safetyStock, reorderPoint, belowReorderPoint, required, rawQty, suggestedQty, outcome };
};

// AI-005: the preferred active supplier of the product; otherwise the lowest unit
// price among active suppliers. Ties break on the lowest supplier id so the
// choice is deterministic. `options` are SupplierProduct rows with `supplier.isActive`.
const selectSupplier = (options) => {
  const active = options.filter((option) => option.supplier?.isActive);

  if (active.length === 0) {
    return null;
  }

  const byPriceThenId = (a, b) => Number(a.unitPrice) - Number(b.unitPrice) || a.supplierId - b.supplierId;
  const preferred = active.filter((option) => option.isPreferred).sort(byPriceThenId);

  if (preferred.length > 0) {
    return { option: preferred[0], reason: "PREFERRED" };
  }

  return { option: [...active].sort(byPriceThenId)[0], reason: "LOWEST_PRICE" };
};

// Quantity on its way to one warehouse. `destinationQty` is open PO quantity addressed to
// this warehouse; `unaddressedQty` is open quantity of POs without a destination, shared out by
// this warehouse's slice of the product's forecast daily demand. The share is floored when stored
// (never assume more stock is coming than is certain); the exact value is returned for transparency.
const onOrderFor = ({ destinationQty, unaddressedQty, warehouseDaily, productDaily }) => {
  const share = productDaily > 0 ? warehouseDaily / productDaily : 0;
  const shared = unaddressedQty * share;
  const exact = destinationQty + shared;

  let method = "NONE";

  if (destinationQty > 0 && shared > 0) {
    method = "DESTINATION+DEMAND_SHARE";
  } else if (destinationQty > 0) {
    method = "DESTINATION";
  } else if (shared > 0) {
    method = "DEMAND_SHARE";
  }

  return {
    onOrder: Math.floor(Math.round(exact * 1e6) / 1e6),
    exact,
    destinationQty,
    unaddressedQty,
    share,
    method,
  };
};

module.exports = { computeReplenishment, selectSupplier, onOrderFor, ceilSafe };
