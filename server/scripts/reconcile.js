#!/usr/bin/env node
// Reconciliation check (SEED-005, NFR-002): does the stock ledger tell the same
// story as the inventory rows and the procurement documents?
//
//   npm run reconcile                       whole database
//   npm run reconcile -- --scope seed       only SYN- (synthetic) data
//   npm run reconcile -- --strict           warnings (inventory without a ledger) fail too
//
// Read-only. Exit code 0 = consistent, 1 = errors found (or warnings under --strict).
//
// Not checked: reserved quantity. A RESERVATION/RELEASE ledger row has quantity 0
// and the amount only appears in its free-text reason, so it cannot be rebuilt
// from the ledger. A reservedDelta/reservedAfter column is planned for P4.
const { Prisma } = require("@prisma/client");
const { SKU_PREFIX, SUPPLIER_PREFIX } = require("../prisma/seed/config");

const AFFECTS_ON_HAND = ["RECEIPT", "ISSUE", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"];
const MAX_SHOWN = 15;

const check = (name) => ({ name, checked: 0, errors: [], warnings: [] });

const reconcile = async (prisma, { scope = "all", strict = false } = {}) => {
  if (!["all", "seed"].includes(scope)) {
    throw new Error(`Unknown scope "${scope}" (use all or seed)`);
  }

  const seed = scope === "seed";
  const productScope = (alias) =>
    seed ? Prisma.sql`AND ${Prisma.raw(alias)}."sku" LIKE ${`${SKU_PREFIX}%`}` : Prisma.empty;
  const supplierScope = seed ? Prisma.sql`AND s."code" LIKE ${`${SUPPLIER_PREFIX}%`}` : Prisma.empty;

  const results = [];

  // 1. every inventory row equals the last ledger balance of its series
  {
    const result = check("inventory = last ledger balance");
    const rows = await prisma.$queryRaw`
      SELECT p."sku", w."code" AS warehouse, i."quantity",
        (SELECT t."balanceAfter" FROM "InventoryTransaction" t
          WHERE t."productId" = i."productId" AND t."warehouseId" = i."warehouseId"
          ORDER BY t."createdAt" DESC, t."id" DESC LIMIT 1) AS last_balance
      FROM "Inventory" i
      JOIN "Product" p ON p."id" = i."productId"
      JOIN "Warehouse" w ON w."id" = i."warehouseId"
      WHERE TRUE ${productScope("p")}
      ORDER BY p."sku", w."code"`;

    result.checked = rows.length;

    for (const row of rows) {
      const where = `${row.sku} @ ${row.warehouse}`;

      if (row.last_balance === null) {
        result.warnings.push(`${where}: inventory ${row.quantity} but no ledger rows at all`);
      } else if (row.last_balance !== row.quantity) {
        result.errors.push(`${where}: inventory ${row.quantity} but last ledger balance ${row.last_balance}`);
      }
    }

    // ledger history whose inventory row is gone: fine only if it ended at zero
    const orphaned = await prisma.$queryRaw`
      SELECT p."sku", w."code" AS warehouse, last."balanceAfter" AS last_balance
      FROM (
        SELECT DISTINCT ON (t."productId", t."warehouseId") t."productId", t."warehouseId", t."balanceAfter"
        FROM "InventoryTransaction" t ORDER BY t."productId", t."warehouseId", t."createdAt" DESC, t."id" DESC
      ) last
      JOIN "Product" p ON p."id" = last."productId"
      JOIN "Warehouse" w ON w."id" = last."warehouseId"
      WHERE NOT EXISTS (SELECT 1 FROM "Inventory" i WHERE i."productId" = last."productId" AND i."warehouseId" = last."warehouseId")
        AND last."balanceAfter" <> 0 ${productScope("p")}`;

    orphaned.forEach((row) =>
      result.errors.push(`${row.sku} @ ${row.warehouse}: ledger ends at ${row.last_balance} but there is no inventory row`)
    );
    results.push(result);
  }

  // 2. the ledger chain: each balanceAfter = previous balance + its quantity
  {
    const result = check("ledger chain is continuous");
    const rows = await prisma.$queryRaw`
      WITH ordered AS (
        SELECT t."id", p."sku", w."code" AS warehouse, t."type", t."quantity", t."balanceAfter", t."createdAt",
               LAG(t."balanceAfter") OVER series AS prev_balance,
               ROW_NUMBER() OVER series AS rn
        FROM "InventoryTransaction" t
        JOIN "Product" p ON p."id" = t."productId"
        JOIN "Warehouse" w ON w."id" = t."warehouseId"
        WHERE TRUE ${productScope("p")}
        WINDOW series AS (PARTITION BY t."productId", t."warehouseId" ORDER BY t."createdAt", t."id")
      )
      SELECT *, (CASE WHEN "type"::text = ANY(${AFFECTS_ON_HAND}) THEN "quantity" ELSE 0 END) AS effect
      FROM ordered ORDER BY "sku", warehouse, rn`;

    result.checked = rows.length;

    for (const row of rows) {
      const where = `${row.sku} @ ${row.warehouse} ${new Date(row.createdAt).toISOString()} ${row.type} (ledger id ${row.id})`;

      if (row.balanceAfter < 0) {
        result.errors.push(`${where}: negative balance ${row.balanceAfter}`);
      }

      if (Number(row.rn) > 1) {
        const expected = row.prev_balance + row.effect;

        if (row.balanceAfter !== expected) {
          result.errors.push(`${where}: balanceAfter ${row.balanceAfter}, expected ${expected}`);
        }
      } else {
        const opening = row.balanceAfter - row.effect;

        if (opening !== 0) {
          const message = `${where}: series starts from ${opening}, not 0`;
          (seed ? result.errors : result.warnings).push(message);
        }
      }
    }
    results.push(result);
  }

  // 3. 0 <= reserved <= quantity (the database CHECK, verified independently)
  {
    const result = check("0 <= reserved <= on-hand");
    const rows = await prisma.$queryRaw`
      SELECT p."sku", w."code" AS warehouse, i."quantity", i."reservedQuantity"
      FROM "Inventory" i
      JOIN "Product" p ON p."id" = i."productId"
      JOIN "Warehouse" w ON w."id" = i."warehouseId"
      WHERE TRUE ${productScope("p")}`;

    result.checked = rows.length;
    rows
      .filter((row) => row.quantity < 0 || row.reservedQuantity < 0 || row.reservedQuantity > row.quantity)
      .forEach((row) =>
        result.errors.push(`${row.sku} @ ${row.warehouse}: quantity ${row.quantity}, reserved ${row.reservedQuantity}`)
      );
    results.push(result);
  }

  // 4. purchase orders: received quantities equal what the receipts say
  {
    const result = check("PO received quantity = goods receipts");
    const rows = await prisma.$queryRaw`
      SELECT po."id" AS po_id, po."poNumber", po."status"::text AS status, p."sku", i."quantity", i."receivedQuantity",
        COALESCE((SELECT SUM(gi."quantity") FROM "GoodsReceiptItem" gi
                  JOIN "GoodsReceipt" g ON g."id" = gi."goodsReceiptId"
                  WHERE gi."purchaseOrderItemId" = i."id" AND g."status" = 'RECEIVED'), 0)::int AS receipts
      FROM "PurchaseOrderItem" i
      JOIN "PurchaseOrder" po ON po."id" = i."purchaseOrderId"
      JOIN "Supplier" s ON s."id" = po."supplierId"
      JOIN "Product" p ON p."id" = i."productId"
      WHERE TRUE ${supplierScope}
      ORDER BY po."poNumber", i."id"`;

    result.checked = rows.length;
    const byOrder = new Map();

    for (const row of rows) {
      if (row.receivedQuantity !== row.receipts) {
        result.errors.push(`${row.poNumber} ${row.sku}: receivedQuantity ${row.receivedQuantity} but receipts total ${row.receipts}`);
      }

      if (row.receivedQuantity > row.quantity) {
        result.errors.push(`${row.poNumber} ${row.sku}: received ${row.receivedQuantity} of only ${row.quantity} ordered`);
      }

      if (!byOrder.has(row.poNumber)) byOrder.set(row.poNumber, { status: row.status, lines: [] });
      byOrder.get(row.poNumber).lines.push(row);
    }

    for (const [number, order] of byOrder) {
      if (!["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(order.status)) continue;

      const all = order.lines.every((l) => l.receivedQuantity >= l.quantity);
      const some = order.lines.some((l) => l.receivedQuantity > 0);
      const expected = all ? "RECEIVED" : some ? "PARTIALLY_RECEIVED" : "APPROVED";

      if (order.status !== expected) {
        result.errors.push(`${number}: status ${order.status} but quantities say ${expected}`);
      }
    }
    results.push(result);
  }

  // 5. every goods receipt line has exactly its RECEIPT ledger row, and vice versa
  {
    const result = check("goods receipts <-> ledger");
    const rows = await prisma.$queryRaw`
      SELECT g."receiptNumber", p."sku", w."code" AS warehouse, gi."quantity",
        COALESCE((SELECT SUM(t."quantity") FROM "InventoryTransaction" t
                  WHERE t."referenceType" = 'GOODS_RECEIPT' AND t."referenceId" = g."id"
                    AND t."productId" = gi."productId" AND t."warehouseId" = g."warehouseId" AND t."type" = 'RECEIPT'), 0)::int AS ledgered
      FROM "GoodsReceiptItem" gi
      JOIN "GoodsReceipt" g ON g."id" = gi."goodsReceiptId"
      JOIN "Product" p ON p."id" = gi."productId"
      JOIN "Warehouse" w ON w."id" = g."warehouseId"
      WHERE g."status" = 'RECEIVED' ${productScope("p")}`;

    result.checked = rows.length;
    rows
      .filter((row) => row.quantity !== row.ledgered)
      .forEach((row) =>
        result.errors.push(`${row.receiptNumber} ${row.sku} @ ${row.warehouse}: receipt line ${row.quantity}, ledger ${row.ledgered}`)
      );

    const orphans = await prisma.$queryRaw`
      SELECT t."id", p."sku" FROM "InventoryTransaction" t JOIN "Product" p ON p."id" = t."productId"
      WHERE t."referenceType" = 'GOODS_RECEIPT' ${productScope("p")}
        AND NOT EXISTS (SELECT 1 FROM "GoodsReceiptItem" gi JOIN "GoodsReceipt" g ON g."id" = gi."goodsReceiptId"
                        WHERE g."id" = t."referenceId" AND gi."productId" = t."productId" AND g."warehouseId" = t."warehouseId")`;

    orphans.forEach((row) => result.errors.push(`ledger row ${row.id} (${row.sku}) references a goods receipt line that does not exist`));
    results.push(result);
  }

  // 6. transfers: what left one warehouse arrived at the other
  {
    const result = check("transfers out = in");
    const rows = await prisma.$queryRaw`
      SELECT x."transferNumber", p."sku", ti."quantity",
        COALESCE((SELECT SUM(-t."quantity") FROM "InventoryTransaction" t
                  WHERE t."referenceType" = 'STOCK_TRANSFER' AND t."referenceId" = x."id" AND t."productId" = ti."productId"
                    AND t."warehouseId" = x."fromWarehouseId" AND t."type" = 'TRANSFER_OUT'), 0)::int AS sent,
        COALESCE((SELECT SUM(t."quantity") FROM "InventoryTransaction" t
                  WHERE t."referenceType" = 'STOCK_TRANSFER' AND t."referenceId" = x."id" AND t."productId" = ti."productId"
                    AND t."warehouseId" = x."toWarehouseId" AND t."type" = 'TRANSFER_IN'), 0)::int AS received
      FROM "StockTransferItem" ti
      JOIN "StockTransfer" x ON x."id" = ti."transferId"
      JOIN "Product" p ON p."id" = ti."productId"
      WHERE x."status" = 'COMPLETED' ${productScope("p")}`;

    result.checked = rows.length;
    rows
      .filter((row) => row.sent !== row.quantity || row.received !== row.quantity)
      .forEach((row) =>
        result.errors.push(`${row.transferNumber} ${row.sku}: transfer ${row.quantity}, ledger out ${row.sent}, in ${row.received}`)
      );

    const orphans = await prisma.$queryRaw`
      SELECT t."id", p."sku" FROM "InventoryTransaction" t JOIN "Product" p ON p."id" = t."productId"
      WHERE t."referenceType" = 'STOCK_TRANSFER' ${productScope("p")}
        AND NOT EXISTS (SELECT 1 FROM "StockTransferItem" ti WHERE ti."transferId" = t."referenceId" AND ti."productId" = t."productId")`;

    orphans.forEach((row) => result.errors.push(`ledger row ${row.id} (${row.sku}) references a transfer line that does not exist`));
    results.push(result);
  }

  const errors = results.reduce((n, r) => n + r.errors.length, 0);
  const warnings = results.reduce((n, r) => n + r.warnings.length, 0);

  return { scope, strict, ok: errors === 0 && !(strict && warnings > 0), errors, warnings, results };
};

const formatReport = (report, databaseName) => {
  const lines = [`Reconcile (scope: ${report.scope}${report.strict ? ", strict" : ""}) on database ${databaseName}`];
  const width = Math.max(...report.results.map((r) => r.name.length));

  for (const r of report.results) {
    lines.push(
      `  ${r.name.padEnd(width)}  ${String(r.checked).padStart(6)} checked  ${r.errors.length} errors  ${r.warnings.length} warnings`
    );
  }

  const findings = [
    ...report.results.flatMap((r) => r.errors.map((m) => `ERROR   [${r.name}] ${m}`)),
    ...report.results.flatMap((r) => r.warnings.map((m) => `WARNING [${r.name}] ${m}`)),
  ];

  if (findings.length > 0) {
    lines.push("", ...findings.slice(0, MAX_SHOWN));

    if (findings.length > MAX_SHOWN) {
      lines.push(`... and ${findings.length - MAX_SHOWN} more`);
    }
  }

  lines.push("", `Result: ${report.ok ? "OK" : "FAILED"} (${report.errors} errors, ${report.warnings} warnings)`);

  return lines.join("\n");
};

const parseArgs = (argv) => {
  const options = { scope: "all", strict: false };

  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = argv[i].split("=");

    if (name === "--scope") {
      options.scope = inline ?? argv[(i += 1)];
    } else if (name === "--strict") {
      options.strict = true;
    } else {
      throw new Error(`Unknown option ${argv[i]} (use --scope all|seed, --strict)`);
    }
  }

  return options;
};

// Runs the check and prints the report; returns the exit code.
const run = async (prisma, options, log = console.log) => {
  const report = await reconcile(prisma, options);
  const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;

  log(formatReport(report, name));

  return report.ok ? 0 : 1;
};

const main = async (argv, deps = {}) => {
  const log = deps.log ?? console.log;

  try {
    const options = parseArgs(argv);
    const prisma = deps.prisma ?? require("../src/config/prisma");

    try {
      return await run(prisma, options, log);
    } finally {
      if (!deps.prisma) {
        await prisma.$disconnect();
      }
    }
  } catch (error) {
    log(`Reconcile failed: ${error.message}`);
    return 1;
  }
};

module.exports = { reconcile, formatReport, run, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
