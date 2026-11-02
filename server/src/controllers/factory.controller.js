const factoryService = require("../services/factory.service");

const createFactory = async (req, res, next) => {
  try {
    const factory = await factoryService.createFactory(req.body);

    res.status(201).json({
      success: true,
      message: "Factory created successfully",
      data: factory,
    });
  } catch (error) {
    next(error);
  }
};

const getAllFactories = async (req, res, next) => {
  try {
    const factories = await factoryService.getAllFactories();

    res.json({
      success: true,
      data: factories,
    });
  } catch (error) {
    next(error);
  }
};

const getFactoryById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const factory = await factoryService.getFactoryById(id);

    res.json({
      success: true,
      data: factory,
    });
  } catch (error) {
    next(error);
  }
};

const updateFactory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const factory = await factoryService.updateFactory(id, req.body);

    res.json({
      success: true,
      message: "Factory updated successfully",
      data: factory,
    });
  } catch (error) {
    next(error);
  }
};

const deleteFactory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    await factoryService.deactivateFactory(id);

    res.json({
      success: true,
      message: "Factory deactivated successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createFactory,
  getAllFactories,
  getFactoryById,
  updateFactory,
  deleteFactory,
};