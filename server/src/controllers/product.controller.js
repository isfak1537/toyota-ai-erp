const productService = require("../services/product.service");

const createProduct = async (req, res) => {
  const product = await productService.createProduct(req.body);

  res.status(201).json({
    success: true,
    message: "Product created successfully",
    data: product,
  });
};

const getAllProducts = async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(
    Math.max(Number(req.query.limit) || 10, 1),
    100
  );

  const search = req.query.search?.trim() || "";

  let isActive = true;

  if (req.query.isActive === "false") {
    isActive = false;
  }

  const allowedSortFields = [
    "name",
    "price",
    "createdAt",
    "reorderLevel",
  ];

  const sortBy = allowedSortFields.includes(req.query.sortBy)
    ? req.query.sortBy
    : "createdAt";

  const sortOrder =
    req.query.sortOrder === "asc" ? "asc" : "desc";

  const result = await productService.getAllProducts({
    page,
    limit,
    search,
    isActive,
    sortBy,
    sortOrder,
  });

  res.json({
    success: true,
    data: result.products,
    pagination: result.pagination,
  });
};

const getProductById = async (req, res) => {
  const id = Number(req.params.id);

  const product = await productService.getProductById(id);

  res.json({
    success: true,
    data: product,
  });
};

const updateProduct = async (req, res) => {
  const id = Number(req.params.id);

  const product = await productService.updateProduct(
    id,
    req.body
  );

  res.json({
    success: true,
    message: "Product updated successfully",
    data: product,
  });
};

const deleteProduct = async (req, res) => {
  const id = Number(req.params.id);

  await productService.deactivateProduct(id);

  res.json({
    success: true,
    message: "Product deactivated successfully",
  });
};

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};