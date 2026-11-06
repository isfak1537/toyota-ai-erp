#!/usr/bin/env node
// Stage the demo, or put it back.
//
//   npm run demo:prepare                    dry run: shows what would be drained
//   npm run demo:prepare -- --apply         drains stock so 3-5 products fall below their AI reorder point
//   npm run demo:prepare -- --apply --sku SYN-BRK-001 --sku SYN-ENG-004 --warehouse SYN-MAIN
//   npm run demo:undo                       dry run
//   npm run demo:undo -- --apply            puts the drained stock back (new RECEIPT rows; nothing is deleted)
//
// Needs the AI service (the reorder point comes from its forecast) and an ADMIN user. After preparing, log in
// as the procurement officer and run replenishment. The AI service ignores these rows (DEMO_PREPARE types).
require("dotenv").config();

const { prepare, undo, DEFAULT_SKUS, DEFAULT_WAREHOUSE } = require("../src/modules/demo/demo-prepare");

const table = (rows) => {
  if (rows.length === 0) return "  (nothing)";
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (cells) => `  ${cells.map((c, i) => String(c ?? "").padEnd(width[i])).join("  ")}`;

  return [line(cols), line(cols.map((_, i) => "-".repeat(width[i]))), ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
};

const parse = (argv) => {
  const options = { apply: false, skus: [], warehouseCode: DEFAULT_WAREHOUSE, allowRemote: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--apply") options.apply = true;
    else if (arg === "--allow-remote") options.allowRemote = true;
    else if (arg === "--sku") options.skus.push(argv[(i += 1)]);
    else if (arg === "--warehouse") options.warehouseCode = argv[(i += 1)];
    else throw new Error(`Unknown option ${arg}`);
  }

  if (options.skus.some((s) => !s)) throw new Error("--sku needs a value");
  if (!options.warehouseCode) throw new Error("--warehouse needs a value");
  if (options.skus.length === 0) options.skus = DEFAULT_SKUS;

  return options;
};

const main = async (argv, log = console.log) => {
  const [mode, ...rest] = argv;

  if (!["prepare", "undo"].includes(mode)) {
    log("Usage: node scripts/demo.js prepare|undo [--apply] [--sku SKU]... [--warehouse CODE] [--allow-remote]");

    return 2;
  }

  try {
    const options = parse(rest);

    if (mode === "prepare") {
      const result = await prepare(options);

      log(`Demo preparation (${result.applied ? "APPLY" : "DRY RUN, nothing is written"}), warehouse ${options.warehouseCode}\n`);
      log(table(result.plans.map((p) => ({ sku: p.sku, available: p.available ?? "", "AI reorder pt": p.reorderPoint ?? "", target: p.target ?? "", drain: p.drain ?? "", "would suggest": p.suggestedQty ?? "", note: p.skip ?? "" }))));
      const ready = result.plans.filter((p) => !p.skip);

      log(result.applied ? `\nDrained ${result.done.length} product(s). Run replenishment as the procurement officer to see ${result.done.length} suggestion(s).` : `\n${ready.length} product(s) would be drained. Add --apply to do it.`);

      return 0;
    }

    const result = await undo(options);

    log(`Undo demo preparation (${result.applied ? "APPLY" : "DRY RUN, nothing is written"})\n`);
    log(table(result.plans.map((p) => ({ sku: p.sku, warehouse: p.warehouse, "put back": p.restore, "drain #": p.transactionId }))));
    log(result.applied ? `\nRestored ${result.done.length} movement(s). Run replenishment again: the old suggestions will expire.` : `\n${result.plans.length} movement(s) would be put back. Add --apply to do it.`);

    return 0;
  } catch (error) {
    log(`Failed: ${error.message}`);

    return 1;
  }
};

module.exports = { main, parse };

if (require.main === module) {
  main(process.argv.slice(2)).then(async (code) => {
    await require("../src/config/prisma").$disconnect();
    process.exitCode = code;
  });
}
