const { ConflictError, NotFoundError, ValidationError } = require("../errors/app-error");
const prisma = require("../config/prisma");

const customerRepository = require("../repositories/customer.repository");

const {
  createCustomerSchema,
  updateCustomerSchema,
} = require("../validators/customer.validator");

function toId(value, fieldName = "id") {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }

  return id;
}

async function createCustomer(input) {
  const data = createCustomerSchema.parse(input);

  const existingCustomer =
    await customerRepository.findCustomerByCode(
      data.customerCode
    );

  if (existingCustomer) {
    throw new ConflictError("Customer code already exists");
  }

  if (data.companyId !== undefined) {
    const company = await prisma.company.findUnique({
      where: {
        id: data.companyId,
      },
    });

    if (!company) {
      throw new NotFoundError("Company not found");
    }

    if (!company.isActive) {
      throw new ConflictError("Company is inactive");
    }
  }

  return customerRepository.createCustomer({
    ...data,
    creditLimit: data.creditLimit ?? 0,
    paymentTermsDays: data.paymentTermsDays ?? 0,
  });
}

async function getAllCustomers(query = {}) {
  const search =
    typeof query.search === "string" &&
    query.search.trim()
      ? query.search.trim()
      : undefined;

  const companyId =
    query.companyId !== undefined
      ? toId(query.companyId, "companyId")
      : undefined;

  let isActive;

  if (query.isActive !== undefined) {
    if (
      query.isActive === "true" ||
      query.isActive === true
    ) {
      isActive = true;
    } else if (
      query.isActive === "false" ||
      query.isActive === false
    ) {
      isActive = false;
    } else {
      throw new ValidationError("isActive must be true or false");
    }
  }

  return customerRepository.findAllCustomers({
    search,
    companyId,
    isActive,
  });
}

async function getCustomerById(id) {
  const customerId = toId(id);

  const customer =
    await customerRepository.findCustomerById(customerId);

  if (!customer) {
    throw new NotFoundError("Customer not found");
  }

  return customer;
}

async function updateCustomer(id, input) {
  const customerId = toId(id);

  const existingCustomer =
    await customerRepository.findCustomerById(customerId);

  if (!existingCustomer) {
    throw new NotFoundError("Customer not found");
  }

  const data = updateCustomerSchema.parse(input);

  return customerRepository.updateCustomer(
    customerId,
    data
  );
}

async function deactivateCustomer(id) {
  const customerId = toId(id);

  const customer =
    await customerRepository.findCustomerById(customerId);

  if (!customer) {
    throw new NotFoundError("Customer not found");
  }

  return customerRepository.updateCustomer(customerId, {
    isActive: false,
  });
}

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
};