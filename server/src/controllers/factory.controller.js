const factoryService = require("../services/factory.service");

const createFactory = async (req, res) => {
  const factory = await factoryService.createFactory(req.body);

  res.status(201).json({
    success: true,
    message: "Factory created successfully",
    data: factory,
  });
};

const getAllFactories = async (req, res) => {
  const factories = await factoryService.getAllFactories();

  res.json({
    success: true,
    data: factories,
  });
};

const getFactoryById = async (req, res) => {
  const id = Number(req.params.id);

  const factory = await factoryService.getFactoryById(id);

  res.json({
    success: true,
    data: factory,
  });
};

const updateFactory = async (req, res) => {
  const id = Number(req.params.id);

  const factory = await factoryService.updateFactory(id, req.body);

  res.json({
    success: true,
    message: "Factory updated successfully",
    data: factory,
  });
};

const deleteFactory = async (req, res) => {
  const id = Number(req.params.id);

  await factoryService.deactivateFactory(id);

  res.json({
    success: true,
    message: "Factory deactivated successfully",
  });
};

module.exports = {
  createFactory,
  getAllFactories,
  getFactoryById,
  updateFactory,
  deleteFactory,
};