const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const { NotFoundError } = require("./errors/app-error");
const errorMiddleware = require("./middlewares/error.middleware");
const customerRoutes = require("./routes/customer.routes");
const companyRoutes = require("./routes/company.routes");
const factoryRoutes = require("./routes/factory.routes");
const warehouseRoutes = require("./routes/warehouse.routes");
const productRoutes = require("./routes/product.routes");
const supplierRoutes = require("./routes/supplier.routes");
const supplierProductRoutes = require("./routes/supplier-product.routes");
const inventoryRoutes = require("./routes/inventory.routes");
const stockTransferRoutes = require("./routes/stock-transfer.routes");
const procurementRoutes = require("./routes/procurement.routes");
const salesOrderRoutes = require("./routes/sales-order.routes");
const authRoutes = require("./routes/auth.routes");
const aiRoutes = require("./routes/ai.routes");
const { authenticate, requireRoleForWrites } = require("./middlewares/auth.middleware");
const roles = require("./middlewares/roles");

const app = express();

app.use(
  cors({
    origin: env.clientUrl,
  })
);

app.use(express.json());
app.use("/api/v1/auth", authRoutes);
// Every business route needs a valid login (401); writes need a role from the matrix (403).
const protect = (path, router, allowed) =>
  app.use(path, authenticate, ...(allowed ? [requireRoleForWrites(...allowed)] : []), router);

protect("/api/v1/sales-orders", salesOrderRoutes, roles.MASTER_DATA);
protect("/api/v1/companies", companyRoutes, roles.MASTER_DATA);
protect("/api/v1/factories", factoryRoutes, roles.MASTER_DATA);
protect("/api/v1/warehouses", warehouseRoutes, roles.MASTER_DATA);
protect("/api/v1/products", productRoutes, roles.MASTER_DATA);
protect("/api/v1/suppliers", supplierRoutes, roles.PROCUREMENT);
protect("/api/v1/supplier-products", supplierProductRoutes, roles.PROCUREMENT);
protect("/api/v1/inventory", inventoryRoutes, roles.STOCK);
protect("/api/v1/stock-transfers", stockTransferRoutes, roles.STOCK);
protect("/api/v1/customers", customerRoutes, roles.MASTER_DATA);
// procurement sets its own roles per route (requisitions, purchase orders, goods receipts, invoices)
protect("/api/v1/procurement", procurementRoutes);
// AI module: each route names its own roles
protect("/api/v1/ai", aiRoutes);

app.use((req, res, next) => {
  next(new NotFoundError("Route not found"));
});

app.use(errorMiddleware);

module.exports = app;
