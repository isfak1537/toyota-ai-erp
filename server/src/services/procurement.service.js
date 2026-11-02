const prisma = require("../config/prisma");

const makeNumber = (prefix) => {
  return `${prefix}-${Date.now()}-${Math.floor(
    100 + Math.random() * 900
  )}`;
};

const toId = (value, fieldName) => {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${fieldName} must be a valid positive integer`);
  }

  return id;
};

const toPositiveInteger = (value, fieldName) => {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return number;
};

const toMoney = (value, fieldName = "amount") => {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} must be a valid non-negative number`);
  }

  return Number(number.toFixed(2));
};

const toDateOrNull = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return date;
};

const calculateTotals = (items, taxAmount = 0) => {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.lineTotal),
    0
  );

  const tax = toMoney(taxAmount, "taxAmount");

  return {
    subtotal: Number(subtotal.toFixed(2)),
    taxAmount: tax,
    totalAmount: Number((subtotal + tax).toFixed(2)),
  };
};

const createRequisition = async (data) => {
  const {
    requesterName,
    supplierId,
    notes,
    items,
  } = data;

  if (!requesterName?.trim()) {
    throw new Error("requesterName is required");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one requisition item is required");
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
      throw new Error("Active supplier not found");
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
      throw new Error(
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
      throw new Error(
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

const getRequisitions = async () => {
  return prisma.purchaseRequisition.findMany({
    orderBy: {
      createdAt: "desc",
    },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
      purchaseOrders: true,
    },
  });
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
    throw new Error("Purchase requisition not found");
  }

  if (requisition.status !== "DRAFT") {
    throw new Error(
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
    throw new Error("Purchase requisition not found");
  }

  if (requisition.status !== "SUBMITTED") {
    throw new Error(
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
    throw new Error("At least one purchase order item is required");
  }

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: parsedSupplierId,
      isActive: true,
    },
  });

  if (!supplier) {
    throw new Error("Active supplier not found");
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
      throw new Error("Purchase requisition not found");
    }

    if (requisition.status !== "APPROVED") {
      throw new Error(
        "Purchase order can only be created from an APPROVED requisition"
      );
    }

    if (
      requisition.supplierId &&
      requisition.supplierId !== parsedSupplierId
    ) {
      throw new Error(
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
      throw new Error(
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
      throw new Error(
        `Active product not found: ${productId}`
      );
    }

    if (requisition) {
      const requisitionItem =
        requisition.items.find(
          (item) => item.productId === productId
        );

      if (!requisitionItem) {
        throw new Error(
          `Product ${productId} does not exist in the approved requisition`
        );
      }

      if (quantity > requisitionItem.quantity) {
        throw new Error(
          `Purchase order quantity for product ${productId} cannot exceed requisition quantity`
        );
      }
    }

    const lineTotal = Number(
      (quantity * unitPrice).toFixed(2)
    );

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

const getPurchaseOrders = async () => {
  return prisma.purchaseOrder.findMany({
    orderBy: {
      createdAt: "desc",
    },
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
  });
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
    throw new Error("Purchase order not found");
  }

  if (purchaseOrder.status !== "PENDING_APPROVAL") {
    throw new Error(
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
    throw new Error(
      "At least one goods receipt item is required"
    );
  }

  const purchaseOrder =
    await prisma.purchaseOrder.findUnique({
      where: {
        id: parsedPurchaseOrderId,
      },
      include: {
        items: true,
      },
    });

  if (!purchaseOrder) {
    throw new Error("Purchase order not found");
  }

  if (
    !["APPROVED", "PARTIALLY_RECEIVED"].includes(
      purchaseOrder.status
    )
  ) {
    throw new Error(
      "Goods receipt requires an APPROVED or PARTIALLY_RECEIVED purchase order"
    );
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id: parsedWarehouseId,
      isActive: true,
    },
  });

  if (!warehouse) {
    throw new Error("Active warehouse not found");
  }

  const receiptProductIds = new Set();
  const receiptItems = [];

  for (const item of items) {
    const purchaseOrderItemId = toId(
      item.purchaseOrderItemId,
      "purchaseOrderItemId"
    );

    const productId = toId(
      item.productId,
      "productId"
    );

    const quantity = toPositiveInteger(
      item.quantity,
      "quantity"
    );

    const poItem = purchaseOrder.items.find(
      (line) => line.id === purchaseOrderItemId
    );

    if (!poItem) {
      throw new Error(
        `Purchase order item not found: ${purchaseOrderItemId}`
      );
    }

    if (poItem.productId !== productId) {
      throw new Error(
        `Product mismatch for purchase order item ${purchaseOrderItemId}`
      );
    }

    if (receiptProductIds.has(productId)) {
      throw new Error(
        `Product ${productId} appears more than once in the goods receipt`
      );
    }

    receiptProductIds.add(productId);

    const remainingQuantity =
      poItem.quantity - poItem.receivedQuantity;

    if (remainingQuantity <= 0) {
      throw new Error(
        `Purchase order item ${purchaseOrderItemId} has already been fully received`
      );
    }

    if (quantity > remainingQuantity) {
      throw new Error(
        `Cannot receive ${quantity}. Remaining quantity for PO item ${purchaseOrderItemId} is ${remainingQuantity}`
      );
    }

    receiptItems.push({
      purchaseOrderItemId,
      productId,
      quantity,
    });
  }

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.goodsReceipt.create({
      data: {
        receiptNumber: makeNumber("GR"),
        purchaseOrderId: purchaseOrder.id,
        warehouseId: warehouse.id,
        status: "RECEIVED",
        notes: notes || null,
        items: {
          create: receiptItems,
        },
      },
    });

    for (const item of receiptItems) {
      const inventory =
        await tx.inventory.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: warehouse.id,
            },
          },
        });

      let balanceAfter;

      if (inventory) {
        balanceAfter =
          inventory.quantity + item.quantity;

        await tx.inventory.update({
          where: {
            id: inventory.id,
          },
          data: {
            quantity: balanceAfter,
          },
        });
      } else {
        balanceAfter = item.quantity;

        await tx.inventory.create({
          data: {
            productId: item.productId,
            warehouseId: warehouse.id,
            quantity: item.quantity,
            reservedQuantity: 0,
          },
        });
      }

      await tx.inventoryTransaction.create({
        data: {
          productId: item.productId,
          warehouseId: warehouse.id,
          type: "RECEIPT",
          quantity: item.quantity,
          balanceAfter,
          referenceType: "GOODS_RECEIPT",
          referenceId: receipt.id,
          reason: `Goods receipt ${receipt.receiptNumber}`,
        },
      });

      await tx.purchaseOrderItem.update({
        where: {
          id: item.purchaseOrderItemId,
        },
        data: {
          receivedQuantity: {
            increment: item.quantity,
          },
        },
      });
    }

    const updatedItems =
      await tx.purchaseOrderItem.findMany({
        where: {
          purchaseOrderId: purchaseOrder.id,
        },
      });

    const allReceived = updatedItems.every(
      (item) =>
        item.receivedQuantity >= item.quantity
    );

    const newStatus = allReceived
      ? "RECEIVED"
      : "PARTIALLY_RECEIVED";

    await tx.purchaseOrder.update({
      where: {
        id: purchaseOrder.id,
      },
      data: {
        status: newStatus,
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

const getGoodsReceipts = async () => {
  return prisma.goodsReceipt.findMany({
    orderBy: {
      createdAt: "desc",
    },
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
  });
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
    throw new Error("invoiceNumber is required");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      "At least one purchase invoice item is required"
    );
  }

  const supplier = await prisma.supplier.findUnique({
    where: {
      id: parsedSupplierId,
    },
  });

  if (!supplier) {
    throw new Error("Supplier not found");
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
      throw new Error("Purchase order not found");
    }

    if (
      purchaseOrder.supplierId !== parsedSupplierId
    ) {
      throw new Error(
        "Invoice supplier does not match purchase order supplier"
      );
    }

    if (purchaseOrder.status === "CANCELLED") {
      throw new Error(
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
      throw new Error(
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
      throw new Error(
        `Active product not found: ${productId}`
      );
    }

    if (purchaseOrder) {
      const poItem = purchaseOrder.items.find(
        (item) => item.productId === productId
      );

      if (!poItem) {
        throw new Error(
          `Product ${productId} does not exist in the purchase order`
        );
      }

      if (quantity > poItem.quantity) {
        throw new Error(
          `Invoice quantity for product ${productId} cannot exceed purchase order quantity`
        );
      }
    }

    const lineTotal = Number(
      (quantity * unitPrice).toFixed(2)
    );

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

  if (parsedPaidAmount > totals.totalAmount) {
    throw new Error(
      "paidAmount cannot exceed invoice totalAmount"
    );
  }

  let status = "UNPAID";

  if (
    parsedPaidAmount > 0 &&
    parsedPaidAmount < totals.totalAmount
  ) {
    status = "PARTIALLY_PAID";
  }

  if (parsedPaidAmount === totals.totalAmount) {
    status = "PAID";
  }

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

const getPurchaseInvoices = async () => {
  return prisma.purchaseInvoice.findMany({
    orderBy: {
      createdAt: "desc",
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