const categoryService = require("../services/category.service");

const createCategory = async (req, res) => {
  const category = await categoryService.createCategory(
    req.body
  );

  res.status(201).json({
    success: true,
    message: "Category created successfully",
    data: category,
  });
};

const getAllCategories = async (req, res) => {
  const categories =
    await categoryService.getAllCategories();

  res.json({
    success: true,
    data: categories,
  });
};

const getCategoryById = async (req, res) => {
  const id = Number(req.params.id);

  const category =
    await categoryService.getCategoryById(id);

  res.json({
    success: true,
    data: category,
  });
};

const updateCategory = async (req, res) => {
  const id = Number(req.params.id);

  const category =
    await categoryService.updateCategory(
      id,
      req.body
    );

  res.json({
    success: true,
    message: "Category updated successfully",
    data: category,
  });
};

const deleteCategory = async (req, res) => {
  const id = Number(req.params.id);

  await categoryService.deleteCategory(id);

  res.json({
    success: true,
    message: "Category deleted successfully",
  });
};

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};