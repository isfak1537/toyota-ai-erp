const { ServiceUnavailableError } = require("../../errors/app-error");

// Shared by the assistant's tools and the days-of-cover endpoint. Read-only: it only reads from `db`
// and asks the AI service for a forecast.

const FORECAST_SERIES_MAX = 100; // stock rows forecast at once (lowest available first)
const COVER_HORIZON = 30;

// Days until `available` units are used up by the forecast daily demand, with a fraction for the last
// day. Returns null when the stock lasts through the whole forecast horizon (more than the horizon).
const daysOfCover = (available, dailyMeans) => {
  if (available <= 0) return 0;

  let remaining = available;

  for (let day = 0; day < dailyMeans.length; day += 1) {
    const demand = Math.max(0, dailyMeans[day]);

    if (demand >= remaining) return Number((day + remaining / demand).toFixed(1));

    remaining -= demand;
  }

  return null;
};

// Stock at or below the product's reorder level (available = on hand minus reserved).
const lowStock = async (db, { limit }) => {
  const rows = await db.inventory.findMany({
    include: { product: { select: { sku: true, name: true, reorderLevel: true } }, warehouse: { select: { code: true } } },
    orderBy: [{ quantity: "asc" }, { id: "asc" }],
  });
  const low = rows
    .map((r) => ({ sku: r.product.sku, name: r.product.name, warehouse: r.warehouse.code, onHand: r.quantity, reserved: r.reservedQuantity, available: r.quantity - r.reservedQuantity, reorderLevel: r.product.reorderLevel }))
    .filter((r) => r.available <= r.reorderLevel);

  return { total: low.length, items: low.slice(0, limit) };
};

// Days of cover per stock row, soonest first, from the AI service's forecast. If the forecasting
// service is down the result says so and carries the low-stock list instead (not a forecast).
const computeDaysOfCover = async ({ db, aiClient, warehouseCode, limit }) => {
  let where = {};

  if (warehouseCode) {
    const warehouse = await db.warehouse.findFirst({ where: { code: warehouseCode }, select: { id: true } });

    if (!warehouse) return { error: "No such warehouse" };

    where = { warehouseId: warehouse.id };
  }

  const rows = await db.inventory.findMany({
    where: { ...where, product: { isActive: true, isStockTracked: true } },
    include: { product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } } },
  });
  const stocked = rows
    .map((r) => ({ r, available: r.quantity - r.reservedQuantity }))
    .sort((a, b) => a.available - b.available || a.r.id - b.r.id)
    .slice(0, FORECAST_SERIES_MAX);

  let response;

  try {
    response = await aiClient().forecast({ series: stocked.map(({ r }) => ({ productId: r.productId, warehouseId: r.warehouseId })), horizonDays: COVER_HORIZON });
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;

    return {
      forecastAvailable: false,
      message: "The forecasting service is unavailable, so days of cover cannot be computed. Showing stock at or below reorder levels instead (not a forecast).",
      fallback: await lowStock(db, { limit }),
    };
  }

  const forecastOf = new Map(response.results.map((x) => [`${x.productId}:${x.warehouseId}`, x]));
  const open = await db.purchaseOrderItem.findMany({
    where: { productId: { in: stocked.map(({ r }) => r.productId) }, purchaseOrder: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } },
    select: { productId: true, quantity: true, receivedQuantity: true, purchaseOrder: { select: { destinationWarehouseId: true } } },
  });
  const incoming = (productId, warehouseId) =>
    open.filter((o) => o.productId === productId && o.purchaseOrder.destinationWarehouseId === warehouseId).reduce((sum, o) => sum + Math.max(0, o.quantity - o.receivedQuantity), 0);

  const items = [];
  let withoutForecast = 0;

  for (const { r, available } of stocked) {
    const f = forecastOf.get(`${r.productId}:${r.warehouseId}`);

    if (!f || f.status !== "OK") {
      withoutForecast += 1;
      continue;
    }

    const means = f.forecast.map((d) => d.mean);
    const cover = daysOfCover(available, means);

    items.push({
      sku: r.product.sku,
      name: r.product.name,
      warehouse: r.warehouse.code,
      available,
      forecastUnitsPerDay: Number(f.dailyMean.toFixed(2)),
      daysOfCover: cover, // null: lasts beyond the 30-day forecast
      lastsBeyondHorizon: cover === null,
      openOrderUnitsToThisWarehouse: incoming(r.productId, r.warehouseId),
      model: f.selectedModel,
    });
  }

  items.sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) || a.sku.localeCompare(b.sku));

  return { forecastAvailable: true, horizonDays: COVER_HORIZON, note: "Days of cover ignore open purchase orders; see openOrderUnitsToThisWarehouse.", withoutForecast, items: items.slice(0, limit) };
};

module.exports = { daysOfCover, lowStock, computeDaysOfCover, FORECAST_SERIES_MAX, COVER_HORIZON };
