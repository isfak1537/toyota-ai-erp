const supplierProductService = require(
  "../services/supplier-product.service"
);

const createSupplierProduct = async (req, res, next) => {
  try {
    const result =
      await supplierProductService.createSupplierProduct(
        req.body
      );

    res.status(201).json({
      success: true,
      message: "Supplier-product relationship created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getAllSupplierProducts = async (req, res, next) => {
  try {
    const results =
      await supplierProductService.getAllSupplierProducts();

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
};

const getSupplierProductById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const result =
      await supplierProductService.getSupplierProductById(id);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const updateSupplierProduct = async (req, res, next) => {
  try {
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
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSupplierProduct,
  getAllSupplierProducts,
  getSupplierProductById,
  updateSupplierProduct,
};