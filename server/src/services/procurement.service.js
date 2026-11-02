const crypto = require("crypto");
const prisma = require("../config/prisma");
const inventoryService = require("./inventory.service");
const {
  calculateTotals,
  invoiceStatusFor,
  lineTotalOf,
  toMoney,
} = require("../utils/money");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../errors/app-error");

const makeNumber = (prefix) => {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
};

const toId = (value, fieldName) => {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`${fieldName} must be a valid positive integer`);
  }

  return id;
};

const toPositiveInteger = (value, fieldName) => {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }

  return number;
};

const toDateOrNull = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid date`);
  }

  return date;
};

const createRequisition = async (data) => {
  const {
    requesterName,
    supplierId,
    notes,
    items,
  } = data;

  if (!requesterName?.trim()) {
    throw new ValidationError("requesterName is required");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("At least one requisition item is required");
  }

  const parsedSupplierId =
    supplierId !== undefined &&
    supplierId !== null &&
    supplierId !== ""
      ? toId(supplierId, "supplierId")
      : null;

  if (parsedSupplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: parsedSupplierId,
        isActive: true,
      },
    });

    if (!supplier) {
      throw new NotFoundError("Active supplier not found");
    }
  }

  const productIds = new Set();

  const requisitionItems = [];

  for (const item of items) {
    const productId = toId(item.productId, "productId");
    const quantity = toPositiveInteger(
      item.quantity,
      "quantity"
    );

    const estimatedUnitPrice = toMoney(
      item.estimatedUnitPrice,
      "estimatedUnitPrice"
    );

    if (productIds.has(productId)) {
      throw new ValidationError(
        `Product ${productId} appears more than once in the requisition`
      );
    }

    productIds.add(productId);

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundError(
        `Active product not found: ${productId}`
      );
    }

    requisitionItems.push({
      productId,
      quantity,
      estimatedUnitPrice,
    });
  }

  return prisma.purchaseRequisition.create({
    data: {
      requisitionNumber: makeNumber("PR"),
      requesterName: requesterName.trim(),
      supplierId: parsedSupplierId,
      status: "DRAFT",
      notes: notes || null,
      items: {
        create: requisitionItems,
      },
    },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};


const getRequisitions = async ({ skip = 0, take = 20 } = {}) => {
  const [items, total] = await prisma.$transaction([
    prisma.purchaseRequisition.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
        purchaseOrders: true,
      },
      skip,
      take,
    }),
    prisma.purchaseRequisition.count(),
  ]);

  return { items, total };
};

const submitRequisition = async (id) => {
  const requisitionId = toId(id, "requisitionId");

  const requisition =
    await prisma.purchaseRequisition.findUnique({
      where: {
        id: requisitionId,
      },
    });

  if (!requisition) {
    throw new NotFoundError("Purchase requisition not found");
  }

  if (requisition.status !== "DRAFT") {
    throw new ConflictError(
      "Only DRAFT requisitions can be submitted"
    );
  }

  return prisma.purchaseRequisition.update({
    where: {
      id: requisitionId,
    },
    data: {
      status: "SUBMITTED",
    },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};

const approveRequisition = async (id) => {
  const requisitionId = toId(id, "requisitionId");

  const requisition =
    await prisma.purchaseRequisition.findUnique({
      where: {
        id: requisitionId,
      },
    });

  if (!requisition) {
    throw new NotFoundError("Purchase requisition not found");
  }

  if (requisition.status !== "SUBMITTED") {
    throw new ConflictError(
      "Only SUBMITTED requisitions can be approved"
    );
  }

  return prisma.purchaseRequisition.update({
    where: {
      id: requisitionId,
    },
    data: {
      status: "APPROVED",
    },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};

const createPurchaseOrder = async (data) => {
  const {
    supplierId,
    requisitionId,
    expectedDate,
    notes,
    taxAmount = 0,
    items,
  } = data;

  const parsedSupplierId = toId(
    supplierId,
    "supplierId"
  );

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("At least one purchase order item is required");
  }

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: parsedSupplierId,
      isActive: true,
    },
  });

  if (!supplier) {
    throw new NotFoundError("Active supplier not found");
  }

  let requisition = null;

  if (
    requisitionId !== undefined &&
    requisitionId !== null &&
    requisitionId !== ""
  ) {
    const parsedRequisitionId = toId(
      requisitionId,
      "requisitionId"
    );

    requisition =
      await prisma.purchaseRequisition.findUnique({
        where: {
          id: parsedRequisitionId,
        },
        include: {
          items: true,
        },
      });

    if (!requisition) {
      throw new NotFoundError("Purchase requisition not found");
    }

    if (requisition.status !== "APPROVED") {
      throw new ConflictError(
        "Purchase order can only be created from an APPROVED requisition"
      );
    }

    if (
      requisition.supplierId &&
      requisition.supplierId !== parsedSupplierId
    ) {
      throw new ValidationError(
        "Purchase order supplier does not match the requisition supplier"
      );
    }
  }

  const productIds = new Set();
  const purchaseOrderItems = [];

  for (const item of items) {
    const productId = toId(item.productId, "productId");

    const quantity = toPositiveInteger(
      item.quantity,
      "quantity"
    );

    const unitPrice = toMoney(
      item.unitPrice,
      "unitPrice"
    );

    if (productIds.has(productId)) {
      throw new ValidationError(
        `Product ${productId} appears more than once in the purchase order`
      );
    }

    productIds.add(productId);

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundError(
        `Active product not found: ${productId}`
      );
    }

    if (requisition) {
      const requisitionItem =
        requisition.items.find(
          (item) => item.productId === productId
        );

      if (!requisitionItem) {
        throw new ValidationError(
          `Product ${productId} does not exist in the approved requisition`
        );
      }

      if (quantity > requisitionItem.quantity) {
        throw new ValidationError(
          `Purchase order quantity for product ${productId} cannot exceed requisition quantity`
        );
      }
    }

    const lineTotal = lineTotalOf(quantity, unitPrice);

    purchaseOrderItems.push({
      productId,
      quantity,
      receivedQuantity: 0,
      unitPrice,
      lineTotal,
    });
  }

  const totals = calculateTotals(
    purchaseOrderItems,
    taxAmount
  );

  const parsedExpectedDate = toDateOrNull(
    expectedDate,
    "expectedDate"
  );

  return prisma.purchaseOrder.create({
    data: {
      poNumber: makeNumber("PO"),
      supplierId: parsedSupplierId,
      requisitionId: requisition
        ? requisition.id
        : null,
      status: "PENDING_APPROVAL",
      expectedDate: parsedExpectedDate,
      notes: notes || null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      items: {
        create: purchaseOrderItems,
      },
    },
    include: {
      supplier: true,
      requisition: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};


const getPurchaseOrders = async ({ skip = 0, take = 20 } = {}) => {
  const [items, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        supplier: true,
        requisition: true,
        items: {
          include: {
            product: true,
          },
        },
        goodsReceipts: true,
        invoices: true,
      },
      skip,
      take,
    }),
    prisma.purchaseOrder.count(),
  ]);

  return { items, total };
};

const approvePurchaseOrder = async (id) => {
  const purchaseOrderId = toId(
    id,
    "purchaseOrderId"
  );

  const purchaseOrder =
    await prisma.purchaseOrder.findUnique({
      where: {
        id: purchaseOrderId,
      },
    });

  if (!purchaseOrder) {
    throw new NotFoundError("Purchase order not found");
  }

  if (purchaseOrder.status !== "PENDING_APPROVAL") {
    throw new ConflictError(
      "Only PENDING_APPROVAL purchase orders can be approved"
    );
  }

  return prisma.purchaseOrder.update({
    where: {
      id: purchaseOrderId,
    },
    data: {
      status: "APPROVED",
    },
    include: {
      supplier: true,
      requisition: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};

const createGoodsReceipt = async (data) => {
  const {
    purchaseOrderId,
    warehouseId,
    notes,
    items,
  } = data;

  const parsedPurchaseOrderId = toId(
    purchaseOrderId,
    "purchaseOrderId"
  );

  const parsedWarehouseId = toId(
    warehouseId,
    "warehouseId"
  );

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError(
      "At least one goods receipt item is required"
    );
  }

  const requestedItems = items.map((item) => ({
    purchaseOrderItemId: toId(
      item.purchaseOrderItemId,
      "purchaseOrderItemId"
    ),
    productId: toId(item.productId, "productId"),
    quantity: toPositiveInteger(item.quantity, "quantity"),
  }));

  return prisma.$transaction(async (tx) => {
    // Lock the purchase order first. Receipts for one PO are serialised, so the
    // remaining-quantity checks below and the PO status update at the end see
    // every earlier receipt (D-03). Receipts always take this lock before any
    // inventory row lock, and nothing takes them in the opposite order.
    const locked = await tx.$queryRaw`
      SELECT "id", "status" FROM "PurchaseOrder"
      WHERE "id" = ${parsedPurchaseOrderId}::int
      FOR UPDATE
    `;

    if (locked.length === 0) {
      throw new NotFoundError("Purchase order not found");
    }

    if (
      !["APPROVED", "PARTIALLY_RECEIVED"].includes(
        locked[0].status
      )
    ) {
      throw new ConflictError(
        "Goods receipt requires an APPROVED or PARTIALLY_RECEIVED purchase order"
      );
    }

    const warehouse = await tx.warehouse.findFirst({
      where: {
        id: parsedWarehouseId,
        isActive: true,
      },
    });

    if (!warehouse) {
      throw new NotFoundError("Active warehouse not found");
    }

    const purchaseOrderItems = await tx.purchaseOrderItem.findMany({
      where: {
        purchaseOrderId: parsedPurchaseOrderId,
      },
    });

    const receiptProductIds = new Set();
    const lines = [];

    for (const requested of requestedItems) {
      const { purchaseOrderItemId, productId, quantity } = requested;

      const poItem = purchaseOrderItems.find(
        (line) => line.id === purchaseOrderItemId
      );

      if (!poItem) {
        throw new NotFoundError(
          `Purchase order item not found: ${purchaseOrderItemId}`
        );
      }

      if (poItem.productId !== productId) {
        throw new ValidationError(
          `Product mismatch for purchase order item ${purchaseOrderItemId}`
        );
      }

      if (receiptProductIds.has(productId)) {
        throw new ValidationError(
          `Product ${productId} appears more than once in the goods receipt`
        );
      }

      receiptProductIds.add(productId);

      const remainingQuantity =
        poItem.quantity - poItem.receivedQuantity;

      if (remainingQuantity <= 0) {
        throw new ConflictError(
          `Purchase order item ${purchaseOrderItemId} has already been fully received`
        );
      }

      if (quantity > remainingQuantity) {
        throw new ConflictError(
          `Cannot receive ${quantity}. Remaining quantity for PO item ${purchaseOrderItemId} is ${remainingQuantity}`
        );
      }

      lines.push({ ...requested, orderedQuantity: poItem.quantity });
    }

    const receipt = await tx.goodsReceipt.create({
      data: {
        receiptNumber: makeNumber("GR"),
        purchaseOrderId: parsedPurchaseOrderId,
        warehouseId: warehouse.id,
        status: "RECEIVED",
        notes: notes || null,
        items: {
          create: lines.map(
            ({ purchaseOrderItemId, productId, quantity }) => ({
              purchaseOrderItemId,
              productId,
              quantity,
            })
          ),
        },
      },
    });

    // Inventory rows are touched in productId order so concurrent receipts and
    // transfers always lock rows in the same order.
    const ordered = [...lines].sort((a, b) => a.productId - b.productId);

    for (const line of ordered) {
      // Atomic guard: only claim the quantity if it still fits the ordered one.
      const claimed = await tx.purchaseOrderItem.updateMany({
        where: {
          id: line.purchaseOrderItemId,
          receivedQuantity: {
            lte: line.orderedQuantity - line.quantity,
          },
        },
        data: {
          receivedQuantity: {
            increment: line.quantity,
          },
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictError(
          `Cannot receive ${line.quantity}. Remaining quantity for PO item ${line.purchaseOrderItemId} is no longer sufficient`
        );
      }

      await inventoryService.receiveIntoWarehouseInTx(tx, {
        productId: line.productId,
        warehouseId: warehouse.id,
        quantity: line.quantity,
        referenceType: "GOODS_RECEIPT",
        referenceId: receipt.id,
        reason: `Goods receipt ${receipt.receiptNumber}`,
      });
    }

    const updatedItems =
      await tx.purchaseOrderItem.findMany({
        where: {
          purchaseOrderId: parsedPurchaseOrderId,
        },
      });

    const allReceived = updatedItems.every(
      (item) =>
        item.receivedQuantity >= item.quantity
    );

    await tx.purchaseOrder.update({
      where: {
        id: parsedPurchaseOrderId,
      },
      data: {
        status: allReceived
          ? "RECEIVED"
          : "PARTIALLY_RECEIVED",
      },
    });

    return tx.goodsReceipt.findUnique({
      where: {
        id: receipt.id,
      },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            items: {
              include: {
                product: true,
              },
            },
          },
        },
        warehouse: true,
        items: {
          include: {
            product: true,
            purchaseOrderItem: true,
          },
        },
      },
    });
  });
};


const getGoodsReceipts = async ({ skip = 0, take = 20 } = {}) => {
  const [items, total] = await prisma.$transaction([
    prisma.goodsReceipt.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
          },
        },
        warehouse: true,
        items: {
          include: {
            product: true,
            purchaseOrderItem: true,
          },
        },
      },
      skip,
      take,
    }),
    prisma.goodsReceipt.count(),
  ]);

  return { items, total };
};

const createPurchaseInvoice = async (data) => {
  const {
    invoiceNumber,
    supplierId,
    purchaseOrderId,
    dueDate,
    taxAmount = 0,
    paidAmount = 0,
    notes,
    items,
  } = data;

  const parsedSupplierId = toId(
    supplierId,
    "supplierId"
  );

  if (!invoiceNumber?.trim()) {
    throw new ValidationError("invoiceNumber is required");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError(
      "At least one purchase invoice item is required"
    );
  }

  const supplier = await prisma.supplier.findUnique({
    where: {
      id: parsedSupplierId,
    },
  });

  if (!supplier) {
    throw new NotFoundError("Supplier not found");
  }

  let purchaseOrder = null;

  if (
    purchaseOrderId !== undefined &&
    purchaseOrderId !== null &&
    purchaseOrderId !== ""
  ) {
    const parsedPurchaseOrderId = toId(
      purchaseOrderId,
      "purchaseOrderId"
    );

    purchaseOrder =
      await prisma.purchaseOrder.findUnique({
        where: {
          id: parsedPurchaseOrderId,
        },
        include: {
          items: true,
        },
      });

    if (!purchaseOrder) {
      throw new NotFoundError("Purchase order not found");
    }

    if (
      purchaseOrder.supplierId !== parsedSupplierId
    ) {
      throw new ValidationError(
        "Invoice supplier does not match purchase order supplier"
      );
    }

    if (purchaseOrder.status === "CANCELLED") {
      throw new ConflictError(
        "Cannot create invoice for a cancelled purchase order"
      );
    }
  }

  const productIds = new Set();
  const invoiceItems = [];

  for (const item of items) {
    const productId = toId(
      item.productId,
      "productId"
    );

    const quantity = toPositiveInteger(
      item.quantity,
      "quantity"
    );

    const unitPrice = toMoney(
      item.unitPrice,
      "unitPrice"
    );

    if (productIds.has(productId)) {
      throw new ValidationError(
        `Product ${productId} appears more than once in the invoice`
      );
    }

    productIds.add(productId);

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundError(
        `Active product not found: ${productId}`
      );
    }

    if (purchaseOrder) {
      const poItem = purchaseOrder.items.find(
        (item) => item.productId === productId
      );

      if (!poItem) {
        throw new ValidationError(
          `Product ${productId} does not exist in the purchase order`
        );
      }

      if (quantity > poItem.quantity) {
        throw new ValidationError(
          `Invoice quantity for product ${productId} cannot exceed purchase order quantity`
        );
      }
    }

    const lineTotal = lineTotalOf(quantity, unitPrice);

    invoiceItems.push({
      productId,
      quantity,
      unitPrice,
      lineTotal,
    });
  }

  const totals = calculateTotals(
    invoiceItems,
    taxAmount
  );

  const parsedPaidAmount = toMoney(
    paidAmount,
    "paidAmount"
  );

  if (parsedPaidAmount.greaterThan(totals.totalAmount)) {
    throw new ValidationError(
      "paidAmount cannot exceed invoice totalAmount"
    );
  }

  const status = invoiceStatusFor(
    parsedPaidAmount,
    totals.totalAmount
  );

  const parsedDueDate = toDateOrNull(
    dueDate,
    "dueDate"
  );

  return prisma.purchaseInvoice.create({
    data: {
      invoiceNumber: invoiceNumber.trim(),
      supplierId: parsedSupplierId,
      purchaseOrderId: purchaseOrder
        ? purchaseOrder.id
        : null,
      status,
      dueDate: parsedDueDate,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      paidAmount: parsedPaidAmount,
      notes: notes || null,
      items: {
        create: invoiceItems,
      },
    },
    include: {
      supplier: true,
      purchaseOrder: true,
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};


const getPurchaseInvoices = async ({ skip = 0, take = 20 } = {}) => {
  const [items, total] = await prisma.$transaction([
    prisma.purchaseInvoice.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        supplier: true,
        purchaseOrder: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      skip,
      take,
    }),
    prisma.purchaseInvoice.count(),
  ]);

  return { items, total };
};

module.exports = {
  createRequisition,
  getRequisitions,
  submitRequisition,
  approveRequisition,
  createPurchaseOrder,
  getPurchaseOrders,
  approvePurchaseOrder,
  createGoodsReceipt,
  getGoodsReceipts,
  createPurchaseInvoice,
  getPurchaseInvoices,
};