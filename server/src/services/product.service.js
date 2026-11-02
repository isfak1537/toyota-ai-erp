const productRepository = require("../repositories/product.repository");

const createProduct = async (data) => {
  if (
    data.maxStock !== undefined &&
    data.maxStock !== null &&
    data.maxStock < data.minStock
  ) {
    const error = new Error(
      "Maximum stock cannot be less than minimum stock"
    );
    error.statusCode = 400;
    throw error;
  }

  return productRepository.createProduct(data);
};

const getAllProducts = async ({
  page,
  limit,
  search,
  isActive,
  sortBy,
  sortOrder,
}) => {
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    productRepository.getAllProducts({
      skip,
      take: limit,
      search,
      isActive,
      sortBy,
      sortOrder,
    }),
    productRepository.countProducts({
      search,
      isActive,
    }),
  ]);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getProductById = async (id) => {
  const product = await productRepository.getProductById(id);

  if (!product) {
    const error = new Error("Product not found");
    error.statusCode = 404;
    throw error;
  }

  return product;
};

const updateProduct = async (id, data) => {
  const existingProduct = await getProductById(id);

  const minStock =
    data.minStock !== undefined
      ? data.minStock
      : existingProduct.minStock;

  const maxStock =
    data.maxStock !== undefined
      ? data.maxStock
      : existingProduct.maxStock;

  if (
    maxStock !== null &&
    maxStock !== undefined &&
    maxStock < minStock
  ) {
    const error = new Error(
      "Maximum stock cannot be less than minimum stock"
    );
    error.statusCode = 400;
    throw error;
  }

  return productRepository.updateProduct(id, data);
};

const deactivateProduct = async (id) => {
  await getProductById(id);

  return productRepository.updateProduct(id, {
    isActive: false,
  });
};

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deactivateProduct,
};