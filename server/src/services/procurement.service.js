const crypto = require("crypto");
const prisma = require("../config/prisma");
const inventoryService = require("./inventory.service");
const { parseId } = require("../utils/ids");
const {
  calculateTotals,
  invoiceStatusFor,
  lineTotalOf,
  toMoney,
} = require("../utils/money");
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require("../errors/app-error");
const { writeAudit } = require("./audit.service");

// Roles that may receive goods somewhere other than the purchase order's destination.
const WAREHOUSE_OVERRIDE_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"];

const activeWarehouseOrThrow = async (client, id) => {
  const warehouse = await client.warehouse.findFirst({ where: { id, isActive: true } });

  if (!warehouse) {
    throw new NotFoundError("Active warehouse not found");
  }

  return warehouse;
};

const optionalDestination = (value) =>
  value === undefined || value === null || value === "" ? null : toId(value, "destinationWarehouseId");

const makeNumber = (prefix) => {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
};

const toId = (value, fieldName) =>
  parseId(value, `${fieldName} must be a valid positive integer`);

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

const createRequisition = async (data, actorId) => {
  const {
    requesterName,
    supplierId,
    destinationWarehouseId,
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

  const parsedDestination = optionalDestination(destinationWarehouseId);

  if (parsedDestination) {
    await activeWarehouseOrThrow(prisma, parsedDestination);
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
      createdById: actorId ?? null,
      requesterName: requesterName.trim(),
      supplierId: parsedSupplierId,
      destinationWarehouseId: parsedDestination,
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

  // One conditional update: of any number of concurrent calls exactly one
  // moves the status, the rest get a 409 (state conflict).
  const claimed = await prisma.purchaseRequisition.updateMany({
    where: {
      id: requisitionId,
      status: "DRAFT",
    },
    data: {
      status: "SUBMITTED",
    },
  });

  if (claimed.count === 0) {
    const existing = await prisma.purchaseRequisition.findUnique({
      where: {
        id: requisitionId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new NotFoundError("Purchase requisition not found");
    }

    throw new ConflictError("Only DRAFT requisitions can be submitted");
  }

  return prisma.purchaseRequisition.findUnique({
    where: {
      id: requisitionId,
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


const approveRequisition = async (id, actorId) => {
  const requisitionId = toId(id, "requisitionId");

  // One conditional update: of any number of concurrent calls exactly one
  // moves the status, the rest get a 409 (state conflict).
  const claimed = await prisma.purchaseRequisition.updateMany({
    where: {
      id: requisitionId,
      status: "SUBMITTED",
    },
    data: {
      status: "APPROVED",
      approvedById: actorId ?? null,
    },
  });

  if (claimed.count === 0) {
    const existing = await prisma.purchaseRequisition.findUnique({
      where: {
        id: requisitionId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new NotFoundError("Purchase requisition not found");
    }

    throw new ConflictError("Only SUBMITTED requisitions can be approved");
  }

  return prisma.purchaseRequisition.findUnique({
    where: {
      id: requisitionId,
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
    destinationWarehouseId,
    expectedDate,
    notes,
    taxAmount = 0,
    items,
  } = data;

  const requestedDestination = optionalDestination(destinationWarehouseId);

  const parsedSupplierId = toId(
    supplierId,
    "supplierId"
  );

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("At least one purchase order item is required");
  }

  const hasRequisition =
    requisitionId !== undefined &&
    requisitionId !== null &&
    requisitionId !== "";

  const parsedRequisitionId = hasRequisition
    ? toId(requisitionId, "requisitionId")
    : null;

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: {
        id: parsedSupplierId,
        isActive: true,
      },
    });

    if (!supplier) {
      throw new NotFoundError("Active supplier not found");
    }

    let requisition = null;
    const committedByProduct = new Map();

    if (parsedRequisitionId) {
      // Lock the requisition first. PO creation per requisition is then
      // serialised, so the cumulative quantity check below sees every earlier
      // PO (a sum over other rows cannot be guarded by a single conditional
      // update). Nothing else takes this lock while holding another one.
      const locked = await tx.$queryRaw`
        SELECT "id" FROM "PurchaseRequisition"
        WHERE "id" = ${parsedRequisitionId}::int
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundError("Purchase requisition not found");
      }

      requisition = await tx.purchaseRequisition.findUnique({
        where: {
          id: parsedRequisitionId,
        },
        include: {
          items: true,
        },
      });

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

      const committed = await tx.purchaseOrderItem.groupBy({
        by: ["productId"],
        where: {
          purchaseOrder: {
            requisitionId: parsedRequisitionId,
            status: { not: "CANCELLED" },
          },
        },
        _sum: {
          quantity: true,
        },
      });

      for (const row of committed) {
        committedByProduct.set(row.productId, row._sum.quantity ?? 0);
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

      const product = await tx.product.findFirst({
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
            (line) => line.productId === productId
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

        // Cumulative cap: non-cancelled POs of this requisition plus this one
        // may not exceed the requisition quantity. Depends on other POs, so it
        // is a state conflict (409), not a malformed request.
        const remaining =
          requisitionItem.quantity -
          (committedByProduct.get(productId) ?? 0);

        if (quantity > remaining) {
          throw new ConflictError(
            `Purchase order quantity for product ${productId} exceeds the remaining requisition quantity (${remaining})`
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

    // The destination is inherited from the requisition. Naming a different one is a
    // client error; naming one when the requisition has none is allowed.
    if (
      requisition?.destinationWarehouseId &&
      requestedDestination &&
      requestedDestination !== requisition.destinationWarehouseId
    ) {
      throw new ValidationError(
        "destinationWarehouseId differs from the requisition's destination warehouse"
      );
    }

    const destination = requisition?.destinationWarehouseId ?? requestedDestination;

    if (destination) {
      await activeWarehouseOrThrow(tx, destination);
    }

    return tx.purchaseOrder.create({
      data: {
        poNumber: makeNumber("PO"),
        destinationWarehouseId: destination,
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


const approvePurchaseOrder = async (id, actorId) => {
  const purchaseOrderId = toId(id, "purchaseOrderId");

  // One conditional update: of any number of concurrent calls exactly one
  // moves the status, the rest get a 409 (state conflict).
  const claimed = await prisma.purchaseOrder.updateMany({
    where: {
      id: purchaseOrderId,
      status: "PENDING_APPROVAL",
    },
    data: {
      status: "APPROVED",
      approvedById: actorId ?? null,
    },
  });

  if (claimed.count === 0) {
    const existing = await prisma.purchaseOrder.findUnique({
      where: {
        id: purchaseOrderId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new NotFoundError("Purchase order not found");
    }

    throw new ConflictError("Only PENDING_APPROVAL purchase orders can be approved");
  }

  return prisma.purchaseOrder.findUnique({
    where: {
      id: purchaseOrderId,
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

const createGoodsReceipt = async (data, actor = {}) => {
  const actorId = actor.id;
  const {
    purchaseOrderId,
    warehouseId,
    allowDifferentWarehouse = false,
    notes,
    items,
  } = data;

  const parsedPurchaseOrderId = toId(
    purchaseOrderId,
    "purchaseOrderId"
  );

  const requestedWarehouseId =
    warehouseId === undefined || warehouseId === null || warehouseId === ""
      ? null
      : toId(warehouseId, "warehouseId");

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
      SELECT "id", "status", "destinationWarehouseId" FROM "PurchaseOrder"
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

    // Default to the purchase order's destination; a different warehouse is a 400
    // unless the caller is allowed to override and says so (then it is audited).
    const destinationId = locked[0].destinationWarehouseId;
    const parsedWarehouseId = requestedWarehouseId ?? destinationId;

    if (!parsedWarehouseId) {
      throw new ValidationError(
        "warehouseId is required because the purchase order has no destination warehouse"
      );
    }

    const overriding = Boolean(destinationId) && parsedWarehouseId !== destinationId;

    if (overriding) {
      if (!allowDifferentWarehouse) {
        throw new ValidationError(
          `The purchase order is destined for warehouse ${destinationId}; set allowDifferentWarehouse to receive elsewhere`
        );
      }

      if (!WAREHOUSE_OVERRIDE_ROLES.includes(actor.role)) {
        throw new ForbiddenError(
          "Only an ADMIN or WAREHOUSE_MANAGER may receive into a different warehouse"
        );
      }
    }

    const warehouse = await activeWarehouseOrThrow(tx, parsedWarehouseId);

    if (overriding) {
      await writeAudit(tx, {
        eventType: "GOODS_RECEIPT_WAREHOUSE_OVERRIDE",
        actorUserId: actorId ?? null,
        payload: {
          purchaseOrderId: parsedPurchaseOrderId,
          destinationWarehouseId: destinationId,
          receivedIntoWarehouseId: parsedWarehouseId,
        },
      });
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
        createdById: actorId ?? null,
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
        actorId,
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