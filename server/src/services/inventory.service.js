const { InventoryTransactionType } = require("@prisma/client");
const prisma = require("../config/prisma");
const inventoryRepository = require("../repositories/inventory.repository");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../errors/app-error");

const getInventoryOrThrow = async (tx, id) => {
  const inventory = await tx.inventory.findUnique({
    where: { id },
    include: {
      product: true,
      warehouse: {
        include: {
          factory: true,
        },
      },
    },
  });

  if (!inventory) {
    throw new NotFoundError("Inventory record not found");
  }

  return inventory;
};

const inventoryInclude = {
  product: true,
  warehouse: {
    include: {
      factory: true,
    },
  },
};

// Called when an atomic stock change was rejected (applyDelta returned null).
// The read only picks the right error; it never decides a write.
const failStockChange = async (tx, productId, warehouseId, buildError) => {
  const current = await tx.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });

  if (!current) {
    throw new NotFoundError("Inventory record not found");
  }

  throw buildError(current);
};

const validateProductAndWarehouse = async (tx, productId, warehouseId) => {
  const product = await tx.product.findUnique({ where: { id: productId } });
  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  if (!product.isActive) {
    throw new ConflictError("Product is inactive");
  }

  if (!product.isStockTracked) {
    throw new ConflictError("Stock tracking is disabled for this product");
  }

  if (!warehouse) {
    throw new NotFoundError("Warehouse not found");
  }

  if (!warehouse.isActive) {
    throw new ConflictError("Warehouse is inactive");
  }

  return { product, warehouse };
};

const createInventory = async (data) => {
  const { productId, warehouseId, quantity = 0, reservedQuantity = 0 } = data;

  if (quantity < 0 || reservedQuantity < 0) {
    throw new ValidationError("Quantity cannot be negative");
  }

  if (reservedQuantity > quantity) {
    throw new ValidationError("Reserved quantity cannot be greater than quantity");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const existing = await tx.inventory.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    });

    if (existing) {
      throw new ConflictError("Inventory record already exists for this product and warehouse");
    }

    return tx.inventory.create({
      data,
      include: {
        product: true,
        warehouse: {
          include: {
            factory: true,
          },
        },
      },
    });
  });
};


const getAllInventory = async ({ skip = 0, take = 20 } = {}) => {
  const [items, total] = await prisma.$transaction([
    prisma.inventory.findMany({
      include: inventoryInclude,
      orderBy: { id: "asc" },
      skip,
      take,
    }),
    prisma.inventory.count(),
  ]);

  return { items, total };
};

const getInventoryById = async (id) => {
  return getInventoryOrThrow(prisma, id);
};

const updateInventory = async (id, data) => {
  if (
    data.quantity !== undefined ||
    data.reservedQuantity !== undefined
  ) {
    throw new ValidationError(
      "Direct stock quantity changes are not allowed. Use receive, issue, adjust, reserve, or release operations."
    );
  }

  return prisma.inventory.update({
    where: { id },
    data,
    include: {
      product: true,
      warehouse: {
        include: {
          factory: true,
        },
      },
    },
  });
};


// Stock leaves the system only through ledgered operations, so a record that
// still holds on-hand or reserved stock cannot be deleted. One conditional
// delete keeps this safe against a concurrent receipt or reservation.
const deleteInventory = async (id) => {
  const removed = await prisma.inventory.deleteMany({
    where: {
      id,
      quantity: 0,
      reservedQuantity: 0,
    },
  });

  if (removed.count === 0) {
    const existing = await prisma.inventory.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundError("Inventory record not found");
    }

    throw new ConflictError(
      "Cannot delete an inventory record that still holds stock. Issue or adjust the stock to zero first."
    );
  }

  return { id };
};

const receiveStock = async ({
  productId,
  warehouseId,
  quantity,
  referenceType,
  referenceId,
  reason,
}) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("Receipt quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const updated = await inventoryRepository.applyDelta(tx, {
      productId,
      warehouseId,
      quantityDelta: quantity,
    });

    if (!updated) {
      await failStockChange(
        tx,
        productId,
        warehouseId,
        () => new ConflictError("Inventory record is in an inconsistent state")
      );
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: updated.id },
      include: inventoryInclude,
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "RECEIPT",
        quantity,
        balanceAfter: updated.quantity,
        referenceType: referenceType || "MANUAL_RECEIPT",
        referenceId: referenceId || null,
        reason: reason || null,
      },
    });

    return {
      inventory,
      transaction,
    };
  });
};


// Receipt inside the caller's transaction, for other modules (goods receipt).
// Creates the inventory row if the warehouse has none yet; either way it is one
// atomic statement, and the ledger balance comes from the returned row.
const receiveIntoWarehouseInTx = async (
  tx,
  { productId, warehouseId, quantity, referenceType, referenceId, reason }
) => {
  const updated = await inventoryRepository.increaseOrCreate(tx, {
    productId,
    warehouseId,
    quantity,
  });

  const transaction = await tx.inventoryTransaction.create({
    data: {
      productId,
      warehouseId,
      type: "RECEIPT",
      quantity,
      balanceAfter: updated.quantity,
      referenceType: referenceType || "MANUAL_RECEIPT",
      referenceId: referenceId || null,
      reason: reason || null,
    },
  });

  return { inventory: updated, transaction };
};

const issueStock = async ({
  productId,
  warehouseId,
  quantity,
  referenceType,
  referenceId,
  reason,
}) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("Issue quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const updated = await inventoryRepository.applyDelta(tx, {
      productId,
      warehouseId,
      quantityDelta: -quantity,
    });

    if (!updated) {
      await failStockChange(tx, productId, warehouseId, (current) => {
        const availableQuantity = current.quantity - current.reservedQuantity;

        return new ConflictError(
          `Insufficient available stock. Available: ${availableQuantity}, requested: ${quantity}`
        );
      });
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: updated.id },
      include: inventoryInclude,
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "ISSUE",
        quantity: -quantity,
        balanceAfter: updated.quantity,
        referenceType: referenceType || "MANUAL_ISSUE",
        referenceId: referenceId || null,
        reason: reason || null,
      },
    });

    return {
      inventory,
      transaction,
    };
  });
};

const adjustStock = async ({
  productId,
  warehouseId,
  quantity,
  referenceType,
  referenceId,
  reason,
}) => {
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new ValidationError("Adjustment quantity must be a non-zero integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const updated = await inventoryRepository.applyDelta(tx, {
      productId,
      warehouseId,
      quantityDelta: quantity,
    });

    if (!updated) {
      await failStockChange(tx, productId, warehouseId, (current) => {
        if (current.quantity + quantity < 0) {
          return new ConflictError("Adjustment would result in negative stock");
        }

        return new ConflictError(
          `Adjustment would make stock lower than reserved quantity (${current.reservedQuantity})`
        );
      });
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: updated.id },
      include: inventoryInclude,
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "ADJUSTMENT",
        quantity,
        balanceAfter: updated.quantity,
        referenceType: referenceType || "MANUAL_ADJUSTMENT",
        referenceId: referenceId || null,
        reason: reason || null,
      },
    });

    return {
      inventory,
      transaction,
    };
  });
};

const reserveStock = async ({
  productId,
  warehouseId,
  quantity,
  referenceType,
  referenceId,
  reason,
}) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("Reservation quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const updated = await inventoryRepository.applyDelta(tx, {
      productId,
      warehouseId,
      reservedDelta: quantity,
    });

    if (!updated) {
      await failStockChange(tx, productId, warehouseId, (current) => {
        const availableQuantity = current.quantity - current.reservedQuantity;

        return new ConflictError(
          `Insufficient available stock for reservation. Available: ${availableQuantity}, requested: ${quantity}`
        );
      });
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: updated.id },
      include: inventoryInclude,
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "RESERVATION",
        quantity: 0,
        balanceAfter: updated.quantity,
        referenceType: referenceType || "MANUAL_RESERVATION",
        referenceId: referenceId || null,
        reason: reason || `Reserved ${quantity} units`,
      },
    });

    return {
      inventory,
      transaction,
    };
  });
};


const releaseStock = async ({
  productId,
  warehouseId,
  quantity,
  referenceType,
  referenceId,
  reason,
}) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("Release quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await inventoryRepository.applyDelta(tx, {
      productId,
      warehouseId,
      reservedDelta: -quantity,
    });

    if (!updated) {
      await failStockChange(
        tx,
        productId,
        warehouseId,
        (current) =>
          new ConflictError(
            `Cannot release ${quantity}. Reserved quantity: ${current.reservedQuantity}`
          )
      );
    }

    const inventory = await tx.inventory.findUnique({
      where: { id: updated.id },
      include: inventoryInclude,
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "RELEASE",
        quantity: 0,
        balanceAfter: updated.quantity,
        referenceType: referenceType || "MANUAL_RELEASE",
        referenceId: referenceId || null,
        reason: reason || `Released ${quantity} units`,
      },
    });

    return {
      inventory,
      transaction,
    };
  });
};

const getTransactions = async ({
  productId,
  warehouseId,
  type,
  skip = 0,
  take = 20,
}) => {
  const where = {};

  if (productId) {
    where.productId = Number(productId);

    if (!Number.isInteger(where.productId) || where.productId <= 0) {
      throw new ValidationError("productId must be a positive integer");
    }
  }

  if (warehouseId) {
    where.warehouseId = Number(warehouseId);

    if (!Number.isInteger(where.warehouseId) || where.warehouseId <= 0) {
      throw new ValidationError("warehouseId must be a positive integer");
    }
  }

  if (type) {
    if (!Object.values(InventoryTransactionType).includes(type)) {
      throw new ValidationError(
        `type must be one of: ${Object.values(InventoryTransactionType).join(", ")}`
      );
    }

    where.type = type;
  }

  const [items, total] = await prisma.$transaction([
    prisma.inventoryTransaction.findMany({
      where,
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return { items, total };
};


const getLowStock = async ({ skip = 0, take = 20 } = {}) => {
  const inventory = await prisma.inventory.findMany({
    include: {
      product: true,
      warehouse: true,
    },
    orderBy: [{ quantity: "asc" }, { id: "asc" }],
  });

  // The condition compares two columns across tables, which Prisma cannot
  // filter on, so it is applied here and the page is cut afterwards.
  const lowStock = inventory
    .map((item) => ({
      ...item,
      availableQuantity:
        item.quantity - item.reservedQuantity,
    }))
    .filter(
      (item) =>
        item.availableQuantity <= item.product.reorderLevel
    );

  return {
    items: lowStock.slice(skip, skip + take),
    total: lowStock.length,
  };
};

module.exports = {
  receiveIntoWarehouseInTx,
  createInventory,
  getAllInventory,
  getInventoryById,
  updateInventory,
  deleteInventory,
  receiveStock,
  issueStock,
  adjustStock,
  reserveStock,
  releaseStock,
  getTransactions,
  getLowStock,
};