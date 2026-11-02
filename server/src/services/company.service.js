const { NotFoundError } = require("../errors/app-error");
const companyRepository = require("../repositories/company.repository");

const createCompany = async (data) => {
  return companyRepository.createCompany(data);
};

const getAllCompanies = async () => {
  return companyRepository.getAllCompanies();
};

const getCompanyById = async (id) => {
  const company = await companyRepository.getCompanyById(id);

  if (!company) {
    throw new NotFoundError("Company not found");
  }

  return company;
};

const updateCompany = async (id, data) => {
  await getCompanyById(id);

  return companyRepository.updateCompany(id, data);
};

const deactivateCompany = async (id) => {
  await getCompanyById(id);

  return companyRepository.updateCompany(id, {
    isActive: false,
  });
};

module.exports = {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  deactivateCompany,
};