const prisma = require("../config/prisma");

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
    throw new Error("Inventory record not found");
  }

  return inventory;
};

const validateProductAndWarehouse = async (tx, productId, warehouseId) => {
  const [product, warehouse] = await Promise.all([
    tx.product.findUnique({ where: { id: productId } }),
    tx.warehouse.findUnique({ where: { id: warehouseId } }),
  ]);

  if (!product) {
    throw new Error("Product not found");
  }

  if (!product.isActive) {
    throw new Error("Product is inactive");
  }

  if (!product.isStockTracked) {
    throw new Error("Stock tracking is disabled for this product");
  }

  if (!warehouse) {
    throw new Error("Warehouse not found");
  }

  if (!warehouse.isActive) {
    throw new Error("Warehouse is inactive");
  }

  return { product, warehouse };
};

const createInventory = async (data) => {
  const { productId, warehouseId, quantity = 0, reservedQuantity = 0 } = data;

  if (quantity < 0 || reservedQuantity < 0) {
    throw new Error("Quantity cannot be negative");
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
      throw new Error("Inventory record already exists for this product and warehouse");
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

const getAllInventory = async () => {
  return prisma.inventory.findMany({
    include: {
      product: true,
      warehouse: {
        include: {
          factory: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });
};

const getInventoryById = async (id) => {
  return getInventoryOrThrow(prisma, id);
};

const updateInventory = async (id, data) => {
  if (
    data.quantity !== undefined ||
    data.reservedQuantity !== undefined
  ) {
    throw new Error(
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

const deleteInventory = async (id) => {
  return prisma.inventory.delete({
    where: { id },
  });
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
    throw new Error("Receipt quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const inventory = await tx.inventory.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    });

    if (!inventory) {
      throw new Error("Inventory record not found");
    }

    const newQuantity = inventory.quantity + quantity;

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        quantity: newQuantity,
      },
      include: {
        product: true,
        warehouse: {
          include: {
            factory: true,
          },
        },
      },
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "RECEIPT",
        quantity,
        balanceAfter: newQuantity,
        referenceType: referenceType || "MANUAL_RECEIPT",
        referenceId: referenceId || null,
        reason: reason || null,
      },
    });

    return {
      inventory: updatedInventory,
      transaction,
    };
  });
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
    throw new Error("Issue quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const inventory = await tx.inventory.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    });

    if (!inventory) {
      throw new Error("Inventory record not found");
    }

    const availableQuantity =
      inventory.quantity - inventory.reservedQuantity;

    if (quantity > availableQuantity) {
      throw new Error(
        `Insufficient available stock. Available: ${availableQuantity}, requested: ${quantity}`
      );
    }

    const newQuantity = inventory.quantity - quantity;

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        quantity: newQuantity,
      },
      include: {
        product: true,
        warehouse: {
          include: {
            factory: true,
          },
        },
      },
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "ISSUE",
        quantity: -quantity,
        balanceAfter: newQuantity,
        referenceType: referenceType || "MANUAL_ISSUE",
        referenceId: referenceId || null,
        reason: reason || null,
      },
    });

    return {
      inventory: updatedInventory,
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
    throw new Error("Adjustment quantity must be a non-zero integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const inventory = await tx.inventory.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    });

    if (!inventory) {
      throw new Error("Inventory record not found");
    }

    const newQuantity = inventory.quantity + quantity;

    if (newQuantity < 0) {
      throw new Error("Adjustment would result in negative stock");
    }

    if (newQuantity < inventory.reservedQuantity) {
      throw new Error(
        `Adjustment would make stock lower than reserved quantity (${inventory.reservedQuantity})`
      );
    }

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        quantity: newQuantity,
      },
      include: {
        product: true,
        warehouse: {
          include: {
            factory: true,
          },
        },
      },
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "ADJUSTMENT",
        quantity,
        balanceAfter: newQuantity,
        referenceType: referenceType || "MANUAL_ADJUSTMENT",
        referenceId: referenceId || null,
        reason: reason || null,
      },
    });

    return {
      inventory: updatedInventory,
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
    throw new Error("Reservation quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    await validateProductAndWarehouse(tx, productId, warehouseId);

    const inventory = await tx.inventory.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    });

    if (!inventory) {
      throw new Error("Inventory record not found");
    }

    const availableQuantity =
      inventory.quantity - inventory.reservedQuantity;

    if (quantity > availableQuantity) {
      throw new Error(
        `Insufficient available stock for reservation. Available: ${availableQuantity}, requested: ${quantity}`
      );
    }

    const newReservedQuantity =
      inventory.reservedQuantity + quantity;

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        reservedQuantity: newReservedQuantity,
      },
      include: {
        product: true,
        warehouse: {
          include: {
            factory: true,
          },
        },
      },
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "RESERVATION",
        quantity: 0,
        balanceAfter: inventory.quantity,
        referenceType: referenceType || "MANUAL_RESERVATION",
        referenceId: referenceId || null,
        reason: reason || `Reserved ${quantity} units`,
      },
    });

    return {
      inventory: updatedInventory,
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
    throw new Error("Release quantity must be a positive integer");
  }

  return prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findUnique({
      where: {
        productId_warehouseId: {
          productId,
          warehouseId,
        },
      },
    });

    if (!inventory) {
      throw new Error("Inventory record not found");
    }

    if (quantity > inventory.reservedQuantity) {
      throw new Error(
        `Cannot release ${quantity}. Reserved quantity: ${inventory.reservedQuantity}`
      );
    }

    const newReservedQuantity =
      inventory.reservedQuantity - quantity;

    const updatedInventory = await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        reservedQuantity: newReservedQuantity,
      },
      include: {
        product: true,
        warehouse: {
          include: {
            factory: true,
          },
        },
      },
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "RELEASE",
        quantity: 0,
        balanceAfter: inventory.quantity,
        referenceType: referenceType || "MANUAL_RELEASE",
        referenceId: referenceId || null,
        reason: reason || `Released ${quantity} units`,
      },
    });

    return {
      inventory: updatedInventory,
      transaction,
    };
  });
};

const getTransactions = async ({
  productId,
  warehouseId,
  type,
  limit = 100,
}) => {
  const where = {};

  if (productId) {
    where.productId = Number(productId);
  }

  if (warehouseId) {
    where.warehouseId = Number(warehouseId);
  }

  if (type) {
    where.type = type;
  }

  return prisma.inventoryTransaction.findMany({
    where,
    include: {
      product: true,
      warehouse: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.min(Number(limit) || 100, 500),
  });
};

const getLowStock = async () => {
  const inventory = await prisma.inventory.findMany({
    include: {
      product: true,
      warehouse: true,
    },
    orderBy: {
      quantity: "asc",
    },
  });

  return inventory
    .map((item) => ({
      ...item,
      availableQuantity:
        item.quantity - item.reservedQuantity,
    }))
    .filter(
      (item) =>
        item.availableQuantity <= item.product.reorderLevel
    );
};

module.exports = {
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