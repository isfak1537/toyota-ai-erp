const prisma = require("../config/prisma");

const salesOrderRepository = require("../repositories/sales-order.repository");

const {
  createSalesOrderSchema,
} = require("../validators/sales-order.validator");

function toId(value, fieldName = "id") {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return id;
}

function toMoney(value) {
  return Number(value).toFixed(2);
}

function makeOrderNumber() {
  return `SO-${Date.now()}-${Math.floor(
    100 + Math.random() * 900
  )}`;
}

async function createSalesOrder(input) {
  const data = createSalesOrderSchema.parse(input);

  const customer = await prisma.customer.findUnique({
    where: {
      id: data.customerId,
    },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  if (!customer.isActive) {
    throw new Error("Customer is inactive");
  }

  const productIds = data.items.map(
    (item) => item.productId
  );

  const uniqueProductIds = new Set(productIds);

  if (uniqueProductIds.size !== productIds.length) {
    throw new Error(
      "Duplicate product is not allowed in the same sales order"
    );
  }

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
  });

  if (products.length !== productIds.length) {
    throw new Error(
      "One or more products were not found"
    );
  }

  for (const product of products) {
    if (!product.isActive) {
      throw new Error(
        `Product ${product.sku} is inactive`
      );
    }
  }

  const productMap = new Map(
    products.map((product) => [product.id, product])
  );

  let subtotal = 0;

  const items = data.items.map((item) => {
    const product = productMap.get(item.productId);

    const unitPrice =
      item.unitPrice !== undefined
        ? item.unitPrice
        : Number(product.price);

    const lineTotal = unitPrice * item.quantity;

    subtotal += lineTotal;

    return {
      productId: item.productId,
      quantity: item.quantity,
      deliveredQuantity: 0,
      unitPrice: toMoney(unitPrice),
      lineTotal: toMoney(lineTotal),
    };
  });

  const taxAmount = data.taxAmount ?? 0;
  const totalAmount = subtotal + taxAmount;

  const orderNumber = makeOrderNumber();

  return salesOrderRepository.createSalesOrder({
    orderNumber,
    customerId: data.customerId,
    status: "DRAFT",
    orderDate: data.orderDate ?? new Date(),
    expectedDate: data.expectedDate ?? null,
    notes: data.notes ?? null,
    subtotal: toMoney(subtotal),
    taxAmount: toMoney(taxAmount),
    totalAmount: toMoney(totalAmount),
    items: {
      create: items,
    },
  });
}

async function getAllSalesOrders(query = {}) {
  const search =
    typeof query.search === "string" &&
    query.search.trim()
      ? query.search.trim()
      : undefined;

  const customerId =
    query.customerId !== undefined
      ? toId(query.customerId, "customerId")
      : undefined;

  const status =
    typeof query.status === "string" &&
    query.status.trim()
      ? query.status.trim().toUpperCase()
      : undefined;

  const validStatuses = [
    "DRAFT",
    "CONFIRMED",
    "PARTIALLY_DELIVERED",
    "DELIVERED",
    "CANCELLED",
  ];

  if (status && !validStatuses.includes(status)) {
    throw new Error("Invalid sales order status");
  }

  return salesOrderRepository.findAllSalesOrders({
    search,
    customerId,
    status,
  });
}

async function getSalesOrderById(id) {
  const salesOrderId = toId(id);

  const salesOrder =
    await salesOrderRepository.findSalesOrderById(
      salesOrderId
    );

  if (!salesOrder) {
    throw new Error("Sales order not found");
  }

  return salesOrder;
}

async function confirmSalesOrder(id) {
  const salesOrderId = toId(id);

  const salesOrder =
    await salesOrderRepository.findSalesOrderById(
      salesOrderId
    );

  if (!salesOrder) {
    throw new Error("Sales order not found");
  }

  if (salesOrder.status !== "DRAFT") {
    throw new Error(
      `Only DRAFT sales orders can be confirmed. Current status: ${salesOrder.status}`
    );
  }

  const customer = await prisma.customer.findUnique({
    where: {
      id: salesOrder.customerId,
    },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  if (!customer.isActive) {
    throw new Error("Customer is inactive");
  }

  return salesOrderRepository.updateSalesOrder(
    salesOrderId,
    {
      status: "CONFIRMED",
    }
  );
}

async function cancelSalesOrder(id) {
  const salesOrderId = toId(id);

  const salesOrder =
    await salesOrderRepository.findSalesOrderById(
      salesOrderId
    );

  if (!salesOrder) {
    throw new Error("Sales order not found");
  }

  if (
    salesOrder.status !== "DRAFT" &&
    salesOrder.status !== "CONFIRMED"
  ) {
    throw new Error(
      `Sales order cannot be cancelled from status ${salesOrder.status}`
    );
  }

  return salesOrderRepository.updateSalesOrder(
    salesOrderId,
    {
      status: "CANCELLED",
    }
  );
}

module.exports = {
  createSalesOrder,
  getAllSalesOrders,
  getSalesOrderById,
  confirmSalesOrder,
  cancelSalesOrder,
};