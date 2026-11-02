const crypto = require("crypto");
const prisma = require("../config/prisma");
const inventoryRepository = require("../repositories/inventory.repository");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../errors/app-error");

const generateTransferNumber = () => {
  return `TRF-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
};

const completeTransfer = async ({
  fromWarehouseId,
  toWarehouseId,
  items,
  notes,
}) => {
  if (fromWarehouseId === toWarehouseId) {
    throw new ValidationError("Source and destination warehouses must be different");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("At least one transfer item is required");
  }

  for (const item of items) {
    if (
      !Number.isInteger(Number(item.productId)) ||
      !Number.isInteger(Number(item.quantity)) ||
      Number(item.quantity) <= 0
    ) {
      throw new ValidationError(
        "Each transfer item must have a valid productId and positive quantity"
      );
    }
  }

  for (const [field, value] of [
    ["fromWarehouseId", fromWarehouseId],
    ["toWarehouseId", toWarehouseId],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(`${field} must be a positive integer`);
    }
  }

  const lines = items
    .map((item) => ({
      productId: Number(item.productId),
      quantity: Number(item.quantity),
    }))
    .sort((a, b) => a.productId - b.productId);

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].productId === lines[i - 1].productId) {
      throw new ValidationError(
        `Product ${lines[i].productId} appears more than once in the transfer`
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const fromWarehouse = await tx.warehouse.findUnique({
      where: { id: fromWarehouseId },
    });
    const toWarehouse = await tx.warehouse.findUnique({
      where: { id: toWarehouseId },
    });

    if (!fromWarehouse) {
      throw new NotFoundError("Source warehouse not found");
    }

    if (!toWarehouse) {
      throw new NotFoundError("Destination warehouse not found");
    }

    if (!fromWarehouse.isActive || !toWarehouse.isActive) {
      throw new ConflictError("Both warehouses must be active");
    }

    // Inventory rows are locked in one global order (productId, then
    // warehouseId) so concurrent opposite-direction transfers cannot deadlock:
    // lines are sorted by product and the lower warehouse row is touched first.
    const sourceFirst = fromWarehouseId < toWarehouseId;
    const transferItems = [];

    for (const { productId, quantity } of lines) {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundError(`Product ${productId} not found`);
      }

      if (!product.isActive || !product.isStockTracked) {
        throw new ConflictError(
          `Product ${productId} is inactive or stock tracking is disabled`
        );
      }

      const takeFromSource = async () => {
        const updated = await inventoryRepository.applyDelta(tx, {
          productId,
          warehouseId: fromWarehouseId,
          quantityDelta: -quantity,
        });

        if (updated) {
          return updated;
        }

        const current = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: { productId, warehouseId: fromWarehouseId },
          },
        });

        if (!current) {
          throw new NotFoundError(
            `No inventory found for product ${productId} in source warehouse`
          );
        }

        const available = current.quantity - current.reservedQuantity;

        throw new ConflictError(
          `Insufficient stock for product ${productId}. Available: ${available}, requested: ${quantity}`
        );
      };

      const addToDestination = () =>
        inventoryRepository.increaseOrCreate(tx, {
          productId,
          warehouseId: toWarehouseId,
          quantity,
        });

      let source;
      let destination;

      if (sourceFirst) {
        source = await takeFromSource();
        destination = await addToDestination();
      } else {
        destination = await addToDestination();
        source = await takeFromSource();
      }

      transferItems.push({
        productId,
        quantity,
        sourceBalanceAfter: source.quantity,
        destinationBalanceAfter: destination.quantity,
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
          create: lines.map(({ productId, quantity }) => ({
            productId,
            quantity,
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
    throw new NotFoundError("Stock transfer not found");
  }

  return transfer;
};

module.exports = {
  completeTransfer,
  getAllTransfers,
  getTransferById,
};