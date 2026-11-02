const { NotFoundError, ValidationError } = require("../errors/app-error");
const factoryRepository = require("../repositories/factory.repository");
const companyRepository = require("../repositories/company.repository");

const createFactory = async (data) => {
  const company = await companyRepository.getCompanyById(data.companyId);

  if (!company) {
    throw new NotFoundError("Company not found");
  }

  if (!company.isActive) {
    throw new ValidationError(
      "Cannot create factory under an inactive company"
    );
  }

  return factoryRepository.createFactory(data);
};

const getAllFactories = async () => {
  return factoryRepository.getAllFactories();
};

const getFactoryById = async (id) => {
  const factory = await factoryRepository.getFactoryById(id);

  if (!factory) {
    throw new NotFoundError("Factory not found");
  }

  return factory;
};

const updateFactory = async (id, data) => {
  await getFactoryById(id);

  if (data.companyId !== undefined) {
    const company = await companyRepository.getCompanyById(data.companyId);

    if (!company) {
      throw new NotFoundError("Company not found");
    }

    if (!company.isActive) {
      throw new ValidationError(
        "Cannot assign factory to an inactive company"
      );
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