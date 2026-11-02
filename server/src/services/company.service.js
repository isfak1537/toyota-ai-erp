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
    const error = new Error("Company not found");
    error.statusCode = 404;
    throw error;
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