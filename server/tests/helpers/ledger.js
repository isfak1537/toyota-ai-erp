const { prisma } = require("./db");

const STOCK_AFFECTING = new Set([
  "RECEIPT",
  "ISSUE",
  "ADJUSTMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
]);

const ledgerFor = (productId, warehouseId) =>
  prisma.inventoryTransaction.findMany({
    where: { productId, warehouseId },
    orderBy: { id: "asc" },
  });

// Checks the ledger against the inventory row: every row's balanceAfter equals
// the previous balance plus its quantity (reservations and releases do not move
// on-hand stock) and the final balance equals inventory.quantity.
// `opening` is the on-hand quantity before the first ledger row.
const reconcile = async (productId, warehouseId, opening = 0) => {
  const inventory = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });
  const rows = await ledgerFor(productId, warehouseId);

  let balance = opening;

  for (const row of rows) {
    if (STOCK_AFFECTING.has(row.type)) {
      balance += row.quantity;
    }

    if (row.balanceAfter !== balance) {
      throw new Error(
        `Ledger row ${row.id} (${row.type}) balanceAfter=${row.balanceAfter}, expected ${balance}`
      );
    }
  }

  if (inventory.quantity !== balance) {
    throw new Error(
      `Inventory quantity ${inventory.quantity} does not match last ledger balance ${balance}`
    );
  }

  return { inventory, rows };
};

module.exports = { ledgerFor, reconcile };
