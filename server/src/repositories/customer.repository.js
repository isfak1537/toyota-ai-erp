const prisma = require("../config/prisma");

const customerInclude = {
  company: true,
};

async function createCustomer(data) {
  return prisma.customer.create({
    data,
    include: customerInclude,
  });
}

async function findAllCustomers({
  search,
  companyId,
  isActive,
}) {
  const where = {};

  if (companyId !== undefined) {
    where.companyId = companyId;
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        customerCode: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        phone: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  return prisma.customer.findMany({
    where,
    include: customerInclude,
    orderBy: {
      name: "asc",
    },
  });
}

async function findCustomerById(id) {
  return prisma.customer.findUnique({
    where: { id },
    include: customerInclude,
  });
}

async function findCustomerByCode(customerCode) {
  return prisma.customer.findUnique({
    where: { customerCode },
  });
}

async function updateCustomer(id, data) {
  return prisma.customer.update({
    where: { id },
    data,
    include: customerInclude,
  });
}

module.exports = {
  createCustomer,
  findAllCustomers,
  findCustomerById,
  findCustomerByCode,
  updateCustomer,
};