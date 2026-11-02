require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const company = await prisma.company.upsert({
    where: { code: "TOYOTA" },
    update: {
      name: "Toyota Motor Corporation",
      isActive: true,
    },
    create: {
      name: "Toyota Motor Corporation",
      code: "TOYOTA",
      country: "Japan",
      currencyCode: "USD",
    },
  });

  const factory = await prisma.factory.upsert({
    where: {
      companyId_code: {
        companyId: company.id,
        code: "DHAKA",
      },
    },
    update: {
      name: "Toyota Dhaka Factory",
      isActive: true,
    },
    create: {
      name: "Toyota Dhaka Factory",
      code: "DHAKA",
      companyId: company.id,
      address: "Dhaka, Bangladesh",
    },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factory.id,
        code: "MAIN-WH",
      },
    },
    update: {
      name: "Main Parts Warehouse",
      isActive: true,
    },
    create: {
      name: "Main Parts Warehouse",
      code: "MAIN-WH",
      factoryId: factory.id,
      address: "Dhaka, Bangladesh",
    },
  });

  const category = await prisma.category.upsert({
    where: { name: "Brake & Suspension" },
    update: {},
    create: {
      name: "Brake & Suspension",
    },
  });

  const product = await prisma.product.upsert({
    where: { sku: "SUS-001" },
    update: {
      categoryId: category.id,
      isActive: true,
      isStockTracked: true,
    },
    create: {
      sku: "SUS-001",
      name: "Brake Pad Set",
      description: "Standard brake pad set for passenger vehicles",
      price: 85.0,
      unit: "SET",
      categoryId: category.id,
      reorderLevel: 20,
      minStock: 10,
      maxStock: 200,
    },
  });

  const supplier = await prisma.supplier.upsert({
    where: { code: "SUP-001" },
    update: {
      isActive: true,
    },
    create: {
      name: "ABC Auto Parts Ltd",
      code: "SUP-001",
      email: "supplier@example.com",
      paymentTermsDays: 30,
    },
  });

  await prisma.supplierProduct.upsert({
    where: {
      supplierId_productId: {
        supplierId: supplier.id,
        productId: product.id,
      },
    },
    update: {
      unitPrice: 70.0,
      minimumOrderQty: 10,
      isPreferred: true,
    },
    create: {
      supplierId: supplier.id,
      productId: product.id,
      unitPrice: 70.0,
      minimumOrderQty: 10,
      isPreferred: true,
      leadTimeDays: 7,
    },
  });

  await prisma.inventory.upsert({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id,
      },
    },
    update: {},
    create: {
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: 0,
      reservedQuantity: 0,
    },
  });

  console.log("Phase A seed completed.");

  console.log({
    companyId: company.id,
    factoryId: factory.id,
    warehouseId: warehouse.id,
    productId: product.id,
    supplierId: supplier.id,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });