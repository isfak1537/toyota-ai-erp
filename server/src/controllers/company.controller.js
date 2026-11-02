const companyService = require("../services/company.service");

const createCompany = async (req, res) => {
  const company = await companyService.createCompany(req.body);

  res.status(201).json({
    success: true,
    message: "Company created successfully",
    data: company,
  });
};

const getAllCompanies = async (req, res) => {
  const companies = await companyService.getAllCompanies();

  res.json({
    success: true,
    data: companies,
  });
};

const getCompanyById = async (req, res) => {
  const id = Number(req.params.id);

  const company = await companyService.getCompanyById(id);

  res.json({
    success: true,
    data: company,
  });
};

const updateCompany = async (req, res) => {
  const id = Number(req.params.id);

  const company = await companyService.updateCompany(id, req.body);

  res.json({
    success: true,
    message: "Company updated successfully",
    data: company,
  });
};

const deleteCompany = async (req, res) => {
  const id = Number(req.params.id);

  await companyService.deactivateCompany(id);

  res.json({
    success: true,
    message: "Company deactivated successfully",
  });
};

module.exports = {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
};