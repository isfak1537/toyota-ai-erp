// Test data factories. They write straight through Prisma (bypassing the
// services) so tests can build any starting state, including invalid ones.
const { prisma } = require("./db");

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

const createCompany = (overrides = {}) => {
  const n = next();

  return prisma.company.create({
    data: { name: `Company ${n}`, code: `CO${n}`, ...overrides },
  });
};

const createFactory = async (overrides = {}) => {
  const n = next();
  const companyId = overrides.companyId ?? (await createCompany()).id;

  return prisma.factory.create({
    data: { name: `Factory ${n}`, code: `FA${n}`, ...overrides, companyId },
  });
};

const createWarehouse = async (overrides = {}) => {
  const n = next();
  const factoryId = overrides.factoryId ?? (await createFactory()).id;

  return prisma.warehouse.create({
    data: { name: `Warehouse ${n}`, code: `WH${n}`, ...overrides, factoryId },
  });
};

const createCategory = (overrides = {}) =>
  prisma.category.create({ data: { name: `Category ${next()}`, ...overrides } });

const createProduct = (overrides = {}) => {
  const n = next();

  return prisma.product.create({
    data: {
      sku: `SKU-${n}`,
      name: `Product ${n}`,
      price: "10.00",
      unit: "pcs",
      ...overrides,
    },
  });
};

const createInventory = (overrides) =>
  prisma.inventory.create({
    data: { quantity: 0, reservedQuantity: 0, ...overrides },
  });

const createSupplier = (overrides = {}) => {
  const n = next();

  return prisma.supplier.create({
    data: { name: `Supplier ${n}`, code: `SU${n}`, ...overrides },
  });
};

// product + warehouse + inventory in one call
const stockScenario = async ({ quantity = 0, reserved = 0, product, warehouse } = {}) => {
  const productRow = await createProduct(product);
  const warehouseRow = await createWarehouse(warehouse);
  const inventory = await createInventory({
    productId: productRow.id,
    warehouseId: warehouseRow.id,
    quantity,
    reservedQuantity: reserved,
  });

  return { product: productRow, warehouse: warehouseRow, inventory };
};

// items: [{ productId, quantity, estimatedUnitPrice? }]
const createRequisition = async ({ status = "DRAFT", supplierId = null, items = [], ...rest } = {}) =>
  prisma.purchaseRequisition.create({
    data: {
      requisitionNumber: `PR-T-${next()}`,
      requesterName: "Test Requester",
      status,
      supplierId,
      ...rest,
      items: {
        create: items.map(({ productId, quantity, estimatedUnitPrice = "10.00" }) => ({
          productId,
          quantity,
          estimatedUnitPrice,
        })),
      },
    },
    include: { items: true },
  });

// items: [{ productId, quantity, receivedQuantity?, unitPrice? }]
const createPurchaseOrder = async ({
  status = "APPROVED",
  supplierId,
  requisitionId = null,
  items = [],
  ...rest
} = {}) => {
  const lines = items.map(({ productId, quantity, receivedQuantity = 0, unitPrice = "10.00" }) => ({
    productId,
    quantity,
    receivedQuantity,
    unitPrice,
    lineTotal: (Number(unitPrice) * quantity).toFixed(2),
  }));
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0).toFixed(2);

  return prisma.purchaseOrder.create({
    data: {
      poNumber: `PO-T-${next()}`,
      supplierId: supplierId ?? (await createSupplier()).id,
      requisitionId,
      status,
      subtotal,
      totalAmount: subtotal,
      ...rest,
      items: { create: lines },
    },
    include: { items: true },
  });
};

module.exports = {
  createCompany,
  createFactory,
  createWarehouse,
  createCategory,
  createProduct,
  createInventory,
  createSupplier,
  stockScenario,
  createRequisition,
  createPurchaseOrder,
};
