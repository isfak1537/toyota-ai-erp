#!/usr/bin/env node
// Writes the CSV fixtures the AI service tests and notebooks read, straight from
// the in-memory synthetic dataset (no database). The columns match what the
// read-only role can SELECT, and the anomaly flags are NOT included: the models
// must never see the labels (they only ever see them in anomaly-labels.json,
// for evaluation).
//
//   npm run seed:export-fixtures
//
// A Node test fails when the committed files differ from what this produces.
const fs = require("fs");
const path = require("path");
const { buildDataset } = require("../prisma/seed/build");
const { serializeLabels } = require("../prisma/seed/labels");

const FIXTURE_DIR = path.resolve(__dirname, "../../ai-service/tests/fixtures");

const cell = (value) => {
  if (value === null || value === undefined) return "";

  const text = String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csv = (header, rows) =>
  `${[header.join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n")}\n`;

// Stable synthetic ids: catalog order for products and warehouses, chronological
// position for the ledger (the real database ids are not stable across runs).
const buildFixtures = (dataset = buildDataset()) => {
  const productId = new Map(dataset.products.map((p, i) => [p.sku, i + 1]));
  const warehouseId = new Map(dataset.warehouses.map((w, i) => [w.code, i + 1]));
  const referenceIds = new Map();

  const referenceId = (reference) => {
    if (!reference) return null;

    const key = `${reference.type}:${reference.number}`;
    if (!referenceIds.has(key)) referenceIds.set(key, referenceIds.size + 1);

    return referenceIds.get(key);
  };

  return {
    "ledger.csv": csv(
      ["id", "productId", "warehouseId", "type", "quantity", "balanceAfter", "referenceType", "referenceId", "createdAt"],
      dataset.ledger.map((row, i) => [
        i + 1,
        productId.get(row.sku),
        warehouseId.get(row.warehouseCode),
        row.type,
        row.quantity,
        row.balanceAfter,
        row.referenceType,
        referenceId(row.reference),
        row.createdAt,
      ])
    ),
    "products.csv": csv(
      ["id", "sku", "name"],
      dataset.products.map((p) => [productId.get(p.sku), p.sku, p.name])
    ),
    "warehouses.csv": csv(
      ["id", "code", "name"],
      dataset.warehouses.map((w) => [warehouseId.get(w.code), w.code, w.name])
    ),
    "anomaly-labels.json": serializeLabels(dataset.anomalyLabels),
    // Evaluation-only context for the notebooks (which products the seed steered
    // to demo stock levels). The models never read this file.
    "scenarios.json": `${JSON.stringify(
      {
        note: "Seed scenario profile per product. STEERED products have their last 12 days of demand shaped by the seed generator (SEED-007), so their last-days behaviour is synthetic demand shaping, not natural demand.",
        steeredProfiles: ["NEAR_ROP", "TREND_FAST"],
        profiles: Object.fromEntries(dataset.products.map((p) => [p.sku, p.profile])),
      },
      null,
      2
    )}\n`,
  };
};

const writeFixtures = (dir = FIXTURE_DIR) => {
  fs.mkdirSync(dir, { recursive: true });

  for (const [name, content] of Object.entries(buildFixtures())) {
    fs.writeFileSync(path.join(dir, name), content);
  }
};

module.exports = { buildFixtures, writeFixtures, FIXTURE_DIR };

if (require.main === module) {
  writeFixtures();
  console.log(`Wrote fixtures to ${FIXTURE_DIR}`);
}
