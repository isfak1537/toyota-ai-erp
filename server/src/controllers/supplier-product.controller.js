const supplierProductService = require(
  "../services/supplier-product.service"
);

const createSupplierProduct = async (req, res) => {
  const result =
    await supplierProductService.createSupplierProduct(
      req.body
    );

  res.status(201).json({
    success: true,
    message: "Supplier-product relationship created successfully",
    data: result,
  });
};

const getAllSupplierProducts = async (req, res) => {
  const results =
    await supplierProductService.getAllSupplierProducts();

  res.json({
    success: true,
    data: results,
  });
};

const getSupplierProductById = async (req, res) => {
  const id = Number(req.params.id);

  const result =
    await supplierProductService.getSupplierProductById(id);

  res.json({
    success: true,
    data: result,
  });
};

const updateSupplierProduct = async (req, res) => {
  const id = Number(req.params.id);

  const result =
    await supplierProductService.updateSupplierProduct(
      id,
      req.body
    );

  res.json({
    success: true,
    message: "Supplier-product relationship updated successfully",
    data: result,
  });
};

module.exports = {
  createSupplierProduct,
  getAllSupplierProducts,
  getSupplierProductById,
  updateSupplierProduct,
};