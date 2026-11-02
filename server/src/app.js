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

const app = express();

app.use(
  cors({
    origin: env.clientUrl,
  })
);

app.use(express.json());
app.use("/api/v1/sales-orders", salesOrderRoutes);
app.use("/api/v1/companies", companyRoutes);
app.use("/api/v1/factories", factoryRoutes);
app.use("/api/v1/warehouses", warehouseRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/suppliers", supplierRoutes);
app.use("/api/v1/supplier-products", supplierProductRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/stock-transfers", stockTransferRoutes);
app.use("/api/v1/procurement", procurementRoutes);
app.use("/api/v1/customers", customerRoutes);

app.use((req, res, next) => {
  next(new NotFoundError("Route not found"));
});

app.use(errorMiddleware);

module.exports = app;
