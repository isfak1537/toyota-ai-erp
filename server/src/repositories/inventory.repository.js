const prisma = require("../config/prisma");

const inventoryInclude = {
  product: true,
  warehouse: {
    include: {
      factory: true,
    },
  },
};

const findInventoryByProductAndWarehouse = async (
  productId,
  warehouseId
) => {
  return prisma.inventory.findUnique({
    where: {
      productId_warehouseId: {
        productId,
        warehouseId,
      },
    },
    include: inventoryInclude,
  });
};

const createInventory = async (data) => {
  return prisma.inventory.create({
    data,
    include: inventoryInclude,
  });
};

const getAllInventory = async () => {
  return prisma.inventory.findMany({
    include: inventoryInclude,
    orderBy: {
      id: "asc",
    },
  });
};

const getInventoryById = async (id) => {
  return prisma.inventory.findUnique({
    where: { id },
    include: inventoryInclude,
  });
};

const updateInventory = async (id, data) => {
  return prisma.inventory.update({
    where: { id },
    data,
    include: inventoryInclude,
  });
};

const deleteInventory = async (id) => {
  return prisma.inventory.delete({
    where: { id },
  });
};

// Atomic stock change. One conditional UPDATE ... RETURNING: the row lock is
// taken by the UPDATE itself and, under READ COMMITTED, a concurrent updater
// re-evaluates the WHERE against the latest committed row, so the check and the
// write cannot be separated. The predicate encodes the invariant
// 0 <= reservedQuantity <= quantity. Returns the updated row (the ledger takes
// balanceAfter from it) or null when the row is missing or the change is not
// allowed. Must run inside a transaction. updatedAt is set here because raw SQL
// bypasses Prisma's @updatedAt.
const applyDelta = async (
  tx,
  { productId, warehouseId, quantityDelta = 0, reservedDelta = 0 }
) => {
  const rows = await tx.$queryRaw`
    UPDATE "Inventory"
    SET "quantity" = "quantity" + ${quantityDelta}::int,
        "reservedQuantity" = "reservedQuantity" + ${reservedDelta}::int,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "productId" = ${productId}::int
      AND "warehouseId" = ${warehouseId}::int
      AND "quantity" + ${quantityDelta}::int >= 0
      AND "reservedQuantity" + ${reservedDelta}::int >= 0
      AND "quantity" + ${quantityDelta}::int >= "reservedQuantity" + ${reservedDelta}::int
    RETURNING *
  `;

  return rows[0] ?? null;
};

// Atomic "add stock, creating the row if needed" (transfer destination).
// INSERT ... ON CONFLICT lets concurrent first-time transfers to the same
// product and warehouse all succeed instead of racing on the unique key.
const increaseOrCreate = async (tx, { productId, warehouseId, quantity }) => {
  const rows = await tx.$queryRaw`
    INSERT INTO "Inventory" ("productId", "warehouseId", "quantity", "reservedQuantity", "updatedAt")
    VALUES (${productId}::int, ${warehouseId}::int, ${quantity}::int, 0, (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("productId", "warehouseId") DO UPDATE
    SET "quantity" = "Inventory"."quantity" + EXCLUDED."quantity",
        "updatedAt" = EXCLUDED."updatedAt"
    RETURNING *
  `;

  return rows[0];
};

module.exports = {
  applyDelta,
  increaseOrCreate,
  findInventoryByProductAndWarehouse,
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  deleteInventory,
};