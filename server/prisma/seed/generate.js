#!/usr/bin/env node
// Synthetic demo data generator (SEED-001..008).
//
//   npm run seed:synthetic                         dry run: shows what would happen
//   npm run seed:synthetic -- --apply              write (refuses if seed data exists)
//   npm run seed:synthetic -- --apply --replace    delete seed-owned rows, then write
//   options: --seed N  --end-date YYYY-MM-DD  --write-labels  --allow-remote
//
// Exit codes: 0 ok, 1 error, 2 refused (nothing was changed).
//
// It only ever runs on an explicit command and never touches rows that are not
// seed-owned (SYN- prefixes, see config.js and writer.js).
const { SEED_DEFAULT, END_DATE_DEFAULT, DAYS } = require("./config");
const { buildDataset } = require("./build");
const { writeLabels, LABELS_PATH } = require("./labels");
const { writeDataset, replaceSeedData, describeSeedData, findBlockers } = require("./writer");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const USAGE = `Usage: npm run seed:synthetic -- [--apply] [--replace] [--seed N] [--end-date YYYY-MM-DD]
                                       [--write-labels] [--allow-remote]

  (no flags)       dry run, nothing is written
  --apply          write the dataset (refuses if seed-owned rows already exist)
  --replace        with --apply: first delete the seed-owned rows (SYN- prefixed)
  --seed N         master seed (default ${SEED_DEFAULT})
  --end-date D     last day of the ${DAYS}-day history (default ${END_DATE_DEFAULT})
  --write-labels   write prisma/seed/anomaly-labels.json
  --allow-remote   permit a database host other than localhost`;

const parseArgs = (argv) => {
  const options = { apply: false, replace: false, writeLabels: false, allowRemote: false, help: false };
  const flags = new Set(["--apply", "--replace", "--write-labels", "--allow-remote", "--help", "-h"]);

  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = argv[i].split("=");

    if (name === "--seed" || name === "--end-date") {
      const value = inline ?? argv[(i += 1)];

      if (value === undefined) {
        throw new Error(`${name} needs a value`);
      }

      if (name === "--seed") {
        if (!/^-?\d+$/.test(value)) {
          throw new Error(`--seed must be an integer (got "${value}")`);
        }
        options.seed = Number(value);
      } else {
        options.endDate = value;
      }
    } else if (flags.has(name)) {
      const key = { "--apply": "apply", "--replace": "replace", "--write-labels": "writeLabels", "--allow-remote": "allowRemote", "--help": "help", "-h": "help" }[name];
      options[key] = true;
    } else {
      throw new Error(`Unknown option ${argv[i]}`);
    }
  }

  return options;
};

const hostOf = (databaseUrl) => {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const table = (rows) => {
  const width = Math.max(...rows.map(([label]) => label.length));

  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join("\n");
};

const summarise = (dataset) => {
  const first = dataset.ledger[0].createdAt.slice(0, 10);
  const last = dataset.ledger[dataset.ledger.length - 1].createdAt.slice(0, 10);

  return [
    ["companies / factories", "1 / 1"],
    ["warehouses", dataset.warehouses.length],
    ["categories", dataset.categories.length],
    ["products", dataset.products.length],
    ["suppliers", dataset.suppliers.length],
    ["supplier-product links", dataset.supplierProducts.length],
    ["purchase orders (received / in flight)", `${dataset.purchaseOrders.length} (${dataset.goodsReceipts.length} / ${dataset.purchaseOrders.length - dataset.goodsReceipts.length})`],
    ["stock transfers", dataset.transfers.length],
    ["ledger rows", `${dataset.ledger.length} (${first} .. ${last})`],
    ["inventory rows", dataset.inventory.length],
    ["injected anomalies", dataset.anomalyLabels.count],
  ];
};

const nonZero = (counts) => Object.entries(counts).filter(([, n]) => n > 0).map(([model, n]) => [model, n]);

const main = async (argv, deps = {}) => {
  const log = deps.log ?? console.log;
  let options;

  try {
    options = parseArgs(argv);
  } catch (error) {
    log(`${error.message}\n\n${USAGE}`);
    return 1;
  }

  if (options.help) {
    log(USAGE);
    return 0;
  }

  const seed = options.seed ?? SEED_DEFAULT;
  const endDate = options.endDate ?? END_DATE_DEFAULT;
  let dataset;

  try {
    dataset = buildDataset({ seed, endDate });
  } catch (error) {
    log(error.message);
    return 1;
  }

  if (options.writeLabels) {
    writeLabels(dataset.anomalyLabels);
    log(`Wrote ${LABELS_PATH}${seed !== SEED_DEFAULT || endDate !== END_DATE_DEFAULT ? "  (NOTE: not the default seed/end date, the committed file will now differ)" : ""}`);
  }

  const prisma = deps.prisma ?? require("../../src/config/prisma");
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL;
  const host = hostOf(databaseUrl ?? "");
  const isLocal = host !== null && LOCAL_HOSTS.has(host);

  try {
    const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;
    const existing = await describeSeedData(prisma);
    const blockers = await findBlockers(prisma);

    log(`Synthetic data (seed ${seed}, history ends ${endDate}, ${DAYS} days)`);
    log(`Target database: ${name} on ${host ?? "an unknown host"}${isLocal ? "" : "  (NOT local)"}`);
    log(`Mode: ${options.apply ? (options.replace ? "APPLY with --replace" : "APPLY") : "DRY RUN, nothing is written"}\n`);
    log("Would insert:");
    log(table(summarise(dataset)));
    log(`\nSeed-owned rows already in this database: ${existing.total}`);

    if (existing.total > 0) {
      log(table(nonZero(existing.counts)));
    }

    if (blockers.length > 0) {
      log("\nRows outside the seed that reference seed data (replace refuses while these exist):");
      log(table(blockers.map(({ label, count }) => [label, count])));
    }

    if (!options.apply) {
      log(
        existing.total > 0
          ? "\nDry run only. Seed data exists: --apply alone will refuse; add --replace to delete exactly the rows listed above first."
          : "\nDry run only. Add --apply to write."
      );
      return 0;
    }

    if (!isLocal && !options.allowRemote) {
      log("\nRefusing to write: the database host is not local. Pass --allow-remote if that is really intended.");
      return 2;
    }

    if (existing.total > 0 && !options.replace) {
      log("\nRefusing to write: seed-owned rows already exist. Nothing was changed. Re-run with --replace to delete exactly those rows first.");
      return 2;
    }

    if (options.replace && blockers.length > 0) {
      log("\nRefusing to replace: see the rows above. Nothing was changed.");
      return 2;
    }

    if (existing.total > 0) {
      const deleted = await replaceSeedData(prisma);
      log("\nDeleted seed-owned rows:");
      log(table(nonZero(deleted)));
    }

    const inserted = await writeDataset(prisma, dataset);
    log("\nInserted:");
    log(table(Object.entries(inserted)));

    // prove the load is consistent: inventory = last ledger balance, chains, documents
    const { run } = require("../../scripts/reconcile");

    log("");

    return await run(prisma, { scope: "seed" }, log);
  } catch (error) {
    log(`Failed: ${error.message}`);
    return 1;
  } finally {
    if (!deps.prisma) {
      await prisma.$disconnect();
    }
  }
};

module.exports = { main, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
