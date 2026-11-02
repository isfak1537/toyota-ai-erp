const { NotFoundError } = require("../errors/app-error");
const categoryRepository = require("../repositories/category.repository");

const createCategory = async (data) => {
  return categoryRepository.createCategory(data);
};

const getAllCategories = async () => {
  return categoryRepository.getAllCategories();
};

const getCategoryById = async (id) => {
  const category = await categoryRepository.getCategoryById(id);

  if (!category) {
    throw new NotFoundError("Category not found");
  }

  return category;
};

const updateCategory = async (id, data) => {
  await getCategoryById(id);

  return categoryRepository.updateCategory(id, data);
};

const deleteCategory = async (id) => {
  await getCategoryById(id);

  return categoryRepository.deleteCategory(id);
};

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};