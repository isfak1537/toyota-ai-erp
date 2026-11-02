const prisma = require("../config/prisma");

const salesOrderInclude = {
  customer: {
    include: {
      company: true,
    },
  },
  items: {
    include: {
      product: {
        include: {
          category: true,
        },
      },
    },
    orderBy: {
      id: "asc",
    },
  },
};

async function createSalesOrder(data) {
  return prisma.salesOrder.create({
    data,
    include: salesOrderInclude,
  });
}

async function findAllSalesOrders({
  search,
  customerId,
  status,
}) {
  const where = {};

  if (customerId !== undefined) {
    where.customerId = customerId;
  }

  if (status !== undefined) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      {
        orderNumber: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        customer: {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
      {
        customer: {
          customerCode: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
    ];
  }

  return prisma.salesOrder.findMany({
    where,
    include: salesOrderInclude,
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function findSalesOrderById(id) {
  return prisma.salesOrder.findUnique({
    where: { id },
    include: salesOrderInclude,
  });
}

async function findSalesOrderByNumber(orderNumber) {
  return prisma.salesOrder.findUnique({
    where: { orderNumber },
  });
}

async function updateSalesOrder(id, data) {
  return prisma.salesOrder.update({
    where: { id },
    data,
    include: salesOrderInclude,
  });
}

module.exports = {
  createSalesOrder,
  findAllSalesOrders,
  findSalesOrderById,
  findSalesOrderByNumber,
  updateSalesOrder,
};