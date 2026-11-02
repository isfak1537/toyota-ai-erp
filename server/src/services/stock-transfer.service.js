const prisma = require("../config/prisma");

const generateTransferNumber = () => {
  return `TRF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

const completeTransfer = async ({
  fromWarehouseId,
  toWarehouseId,
  items,
  notes,
}) => {
  if (fromWarehouseId === toWarehouseId) {
    throw new Error("Source and destination warehouses must be different");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one transfer item is required");
  }

  for (const item of items) {
    if (
      !Number.isInteger(Number(item.productId)) ||
      !Number.isInteger(Number(item.quantity)) ||
      Number(item.quantity) <= 0
    ) {
      throw new Error(
        "Each transfer item must have a valid productId and positive quantity"
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const [fromWarehouse, toWarehouse] = await Promise.all([
      tx.warehouse.findUnique({
        where: { id: fromWarehouseId },
      }),
      tx.warehouse.findUnique({
        where: { id: toWarehouseId },
      }),
    ]);

    if (!fromWarehouse) {
      throw new Error("Source warehouse not found");
    }

    if (!toWarehouse) {
      throw new Error("Destination warehouse not found");
    }

    if (!fromWarehouse.isActive || !toWarehouse.isActive) {
      throw new Error("Both warehouses must be active");
    }

    const transferItems = [];

    for (const item of items) {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);

      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new Error(`Product ${productId} not found`);
      }

      if (!product.isActive || !product.isStockTracked) {
        throw new Error(
          `Product ${productId} is inactive or stock tracking is disabled`
        );
      }

      const sourceInventory = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: fromWarehouseId,
          },
        },
      });

      if (!sourceInventory) {
        throw new Error(
          `No inventory found for product ${productId} in source warehouse`
        );
      }

      const available =
        sourceInventory.quantity -
        sourceInventory.reservedQuantity;

      if (quantity > available) {
        throw new Error(
          `Insufficient stock for product ${productId}. Available: ${available}, requested: ${quantity}`
        );
      }

      let destinationInventory = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId: toWarehouseId,
          },
        },
      });

      if (!destinationInventory) {
        destinationInventory = await tx.inventory.create({
          data: {
            productId,
            warehouseId: toWarehouseId,
            quantity: 0,
            reservedQuantity: 0,
          },
        });
      }

      const newSourceQuantity =
        sourceInventory.quantity - quantity;

      const newDestinationQuantity =
        destinationInventory.quantity + quantity;

      await tx.inventory.update({
        where: { id: sourceInventory.id },
        data: {
          quantity: newSourceQuantity,
        },
      });

      await tx.inventory.update({
        where: { id: destinationInventory.id },
        data: {
          quantity: newDestinationQuantity,
        },
      });

      transferItems.push({
        productId,
        quantity,
        sourceBalanceAfter: newSourceQuantity,
        destinationBalanceAfter: newDestinationQuantity,
      });
    }

    const transfer = await tx.stockTransfer.create({
      data: {
        transferNumber: generateTransferNumber(),
        fromWarehouseId,
        toWarehouseId,
        status: "COMPLETED",
        notes: notes || null,
        items: {
          create: items.map((item) => ({
            productId: Number(item.productId),
            quantity: Number(item.quantity),
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        fromWarehouse: true,
        toWarehouse: true,
      },
    });

    for (const item of transferItems) {
      await tx.inventoryTransaction.createMany({
        data: [
          {
            productId: item.productId,
            warehouseId: fromWarehouseId,
            type: "TRANSFER_OUT",
            quantity: -item.quantity,
            balanceAfter: item.sourceBalanceAfter,
            referenceType: "STOCK_TRANSFER",
            referenceId: transfer.id,
            reason: `Transfer ${transfer.transferNumber}`,
          },
          {
            productId: item.productId,
            warehouseId: toWarehouseId,
            type: "TRANSFER_IN",
            quantity: item.quantity,
            balanceAfter: item.destinationBalanceAfter,
            referenceType: "STOCK_TRANSFER",
            referenceId: transfer.id,
            reason: `Transfer ${transfer.transferNumber}`,
          },
        ],
      });
    }

    return transfer;
  });
};

const getAllTransfers = async () => {
  return prisma.stockTransfer.findMany({
    include: {
      items: {
        include: {
          product: true,
        },
      },
      fromWarehouse: true,
      toWarehouse: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

const getTransferById = async (id) => {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: true,
        },
      },
      fromWarehouse: true,
      toWarehouse: true,
    },
  });

  if (!transfer) {
    throw new Error("Stock transfer not found");
  }

  return transfer;
};

module.exports = {
  completeTransfer,
  getAllTransfers,
  getTransferById,
};