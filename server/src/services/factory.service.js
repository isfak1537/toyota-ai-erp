const factoryRepository = require("../repositories/factory.repository");
const companyRepository = require("../repositories/company.repository");

const createFactory = async (data) => {
  const company = await companyRepository.getCompanyById(data.companyId);

  if (!company) {
    const error = new Error("Company not found");
    error.statusCode = 404;
    throw error;
  }

  if (!company.isActive) {
    const error = new Error(
      "Cannot create factory under an inactive company"
    );
    error.statusCode = 400;
    throw error;
  }

  return factoryRepository.createFactory(data);
};

const getAllFactories = async () => {
  return factoryRepository.getAllFactories();
};

const getFactoryById = async (id) => {
  const factory = await factoryRepository.getFactoryById(id);

  if (!factory) {
    const error = new Error("Factory not found");
    error.statusCode = 404;
    throw error;
  }

  return factory;
};

const updateFactory = async (id, data) => {
  await getFactoryById(id);

  if (data.companyId !== undefined) {
    const company = await companyRepository.getCompanyById(data.companyId);

    if (!company) {
      const error = new Error("Company not found");
      error.statusCode = 404;
      throw error;
    }

    if (!company.isActive) {
      const error = new Error(
        "Cannot assign factory to an inactive company"
      );
      error.statusCode = 400;
      throw error;
    }
  }

  return factoryRepository.updateFactory(id, data);
};

const deactivateFactory = async (id) => {
  await getFactoryById(id);

  return factoryRepository.updateFactory(id, {
    isActive: false,
  });
};

module.exports = {
  createFactory,
  getAllFactories,
  getFactoryById,
  updateFactory,
  deactivateFactory,
};