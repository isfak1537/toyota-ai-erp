const categoryService = require("../services/category.service");

const createCategory = async (req, res, next) => {
  try {
    const category = await categoryService.createCategory(
      req.body
    );

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

const getAllCategories = async (req, res, next) => {
  try {
    const categories =
      await categoryService.getAllCategories();

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

const getCategoryById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const category =
      await categoryService.getCategoryById(id);

    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    await categoryService.deleteCategory(id);

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};