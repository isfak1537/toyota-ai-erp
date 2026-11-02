// Master data (SEED-001): 1 company, 1 factory, 2 warehouses, 3 categories,
// 18 auto-part products, 5 suppliers with different prices, lead times, MOQs
// and a preferred flag. Pure data plus the stock-policy numbers derived from it.
const { Prisma } = require("@prisma/client");
const {
  COMPANY_CODE,
  FACTORY_CODE,
  SKU_PREFIX,
  SUPPLIER_PREFIX,
  CATEGORY_PREFIX,
} = require("./config");

const { Decimal } = Prisma;

const company = {
  code: COMPANY_CODE,
  name: "Toyota AI ERP (Synthetic Demo)",
  country: "BD",
  currencyCode: "BDT",
};

const factory = {
  code: FACTORY_CODE,
  name: "Dhaka Plant (Synthetic)",
};

const warehouses = [
  { code: "SYN-MAIN", name: "Main Parts Warehouse (Synthetic)" },
  { code: "SYN-DEPOT", name: "Service Depot (Synthetic)" },
];

const categories = [
  `${CATEGORY_PREFIX}Brakes & Suspension`,
  `${CATEGORY_PREFIX}Engine & Filters`,
  `${CATEGORY_PREFIX}Electrical & Body`,
];

// priceFactor: supplier unit price as a share of the product list price
const suppliers = [
  { code: `${SUPPLIER_PREFIX}S1`, name: "Alpha Auto Parts Co.", paymentTermsDays: 30 },
  { code: `${SUPPLIER_PREFIX}S2`, name: "Beta Components Ltd", paymentTermsDays: 45 },
  { code: `${SUPPLIER_PREFIX}S3`, name: "Gamma Filters Industries", paymentTermsDays: 30 },
  { code: `${SUPPLIER_PREFIX}S4`, name: "Delta Electricals", paymentTermsDays: 60 },
  { code: `${SUPPLIER_PREFIX}S5`, name: "Epsilon Distribution", paymentTermsDays: 15 },
];

// category index -> [preferred, alternative(s)]
const supplierRoutes = {
  0: [
    { supplier: 0, priceFactor: 0.64, leadTimeDays: 7, moqDays: 10 },
    { supplier: 1, priceFactor: 0.68, leadTimeDays: 12, moqDays: 20 },
  ],
  1: [
    { supplier: 2, priceFactor: 0.62, leadTimeDays: 5, moqDays: 10 },
    { supplier: 4, priceFactor: 0.66, leadTimeDays: 9, moqDays: 15 },
  ],
  2: [
    { supplier: 3, priceFactor: 0.65, leadTimeDays: 10, moqDays: 10 },
    { supplier: 1, priceFactor: 0.63, leadTimeDays: 14, moqDays: 25 },
    { supplier: 4, priceFactor: 0.7, leadTimeDays: 8, moqDays: 12 },
  ],
};

// base: units/day at the main warehouse on a normal weekday at the start of the
// history; trend: relative growth of that rate over the 90 days.
// profile drives the SEED-007 demo scenarios:
//   STABLE / TRENDING  natural reorder behaviour
//   NEAR_ROP           ends at `ropRatio` x its reorder point, no open PO
//   TREND_FAST         fast-growing demand, ends with less cover than the lead time
//   OVERSTOCKED        bulk purchase, ends with many months of cover
// inDepot: also stocked at the service depot (and part of one A->B transfer).
const productDefs = [
  { suffix: "BRK-001", name: "Brake Pad Set Front", category: 0, price: "48.00", base: 6, trend: 0.1, profile: "NEAR_ROP", ropRatio: 0.85 },
  { suffix: "BRK-002", name: "Brake Disc Rotor", category: 0, price: "62.50", base: 3, trend: 0, profile: "STABLE", inDepot: true },
  { suffix: "BRK-003", name: "Shock Absorber Front", category: 0, price: "85.00", base: 2, trend: 0.9, profile: "TRENDING" },
  { suffix: "BRK-004", name: "Control Arm Assembly", category: 0, price: "120.00", base: 1.2, trend: 0, profile: "STABLE" },
  { suffix: "BRK-005", name: "Wheel Bearing Kit", category: 0, price: "39.90", base: 2.5, trend: 0, profile: "STABLE", inDepot: true },
  { suffix: "BRK-006", name: "Brake Caliper Rebuild Kit", category: 0, price: "27.80", base: 1.5, trend: 0.6, profile: "TRENDING" },
  { suffix: "ENG-001", name: "Oil Filter", category: 1, price: "8.90", base: 14, trend: 0.05, profile: "NEAR_ROP", ropRatio: 0.95 },
  { suffix: "ENG-002", name: "Air Filter", category: 1, price: "14.50", base: 8, trend: 0, profile: "STABLE", inDepot: true },
  { suffix: "ENG-003", name: "Cabin Air Filter", category: 1, price: "11.20", base: 5, trend: 1.8, profile: "TREND_FAST" },
  { suffix: "ENG-004", name: "Spark Plug Set (4 pcs)", category: 1, price: "32.00", base: 6, trend: 0, profile: "NEAR_ROP", ropRatio: 1.08 },
  { suffix: "ENG-005", name: "Timing Belt Kit", category: 1, price: "74.00", base: 1, trend: 0, profile: "OVERSTOCKED" },
  { suffix: "ENG-006", name: "Fuel Pump Module", category: 1, price: "142.00", base: 0.8, trend: 0, profile: "STABLE" },
  { suffix: "ENG-007", name: "Water Pump", category: 1, price: "56.00", base: 1.4, trend: 0.7, profile: "TRENDING", inDepot: true },
  { suffix: "ELE-001", name: "Battery 12V 60Ah", category: 2, price: "95.00", base: 3, trend: 0, profile: "NEAR_ROP", ropRatio: 1.2 },
  { suffix: "ELE-002", name: "Alternator", category: 2, price: "165.00", base: 0.7, trend: 0, profile: "STABLE" },
  { suffix: "ELE-003", name: "Headlamp Assembly", category: 2, price: "118.00", base: 1.1, trend: 0.5, profile: "TRENDING", inDepot: true },
  { suffix: "ELE-004", name: "Wiper Blade Set", category: 2, price: "16.40", base: 7, trend: 0, profile: "STABLE", inDepot: true },
  { suffix: "ELE-005", name: "Side Mirror Assembly", category: 2, price: "68.00", base: 0.9, trend: 0, profile: "STABLE" },
];

const round2 = (value) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

const roundUpTo = (value, step) => Math.ceil(value / step) * step;

const buildProducts = () =>
  productDefs.map((def) => {
    const routes = supplierRoutes[def.category];
    const avgDaily = def.base * (1 + def.trend / 2);

    const options = routes.map((route, index) => ({
      supplierCode: suppliers[route.supplier].code,
      supplierSku: `${suppliers[route.supplier].code.slice(SUPPLIER_PREFIX.length)}-${def.suffix}`,
      unitPrice: round2(new Decimal(def.price).times(route.priceFactor)),
      leadTimeDays: route.leadTimeDays,
      minimumOrderQty: Math.max(1, roundUpTo(avgDaily * route.moqDays, 5)),
      isPreferred: index === 0,
    }));

    const preferred = options[0];
    const lead = preferred.leadTimeDays;
    // reorder point = demand over lead time + 2 days, plus ~95% safety stock
    const reorderPoint = Math.ceil(
      avgDaily * (lead + 2) + 1.65 * Math.sqrt(avgDaily * (lead + 2))
    );
    const orderUpTo = reorderPoint + Math.ceil(14 * avgDaily);

    return {
      sku: `${SKU_PREFIX}${def.suffix}`,
      name: def.name,
      categoryName: categories[def.category],
      price: def.price,
      unit: "pcs",
      base: def.base,
      trend: def.trend,
      profile: def.profile,
      ropRatio: def.ropRatio ?? null,
      inDepot: Boolean(def.inDepot),
      reorderLevel: reorderPoint,
      minStock: Math.ceil(reorderPoint * 0.4),
      maxStock:
        def.profile === "OVERSTOCKED"
          ? Math.ceil(60 * avgDaily)
          : Math.ceil(orderUpTo * 1.4),
      orderUpTo,
      supplierOptions: options,
    };
  });

module.exports = {
  company,
  factory,
  warehouses,
  categories,
  suppliers,
  buildProducts,
};
