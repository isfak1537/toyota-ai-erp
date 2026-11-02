const procurementService = require("../../src/services/procurement.service");
const inventoryService = require("../../src/services/inventory.service");
const { ConflictError } = require("../../src/errors/app-error");
const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const f = require("../helpers/factories");
const { reconcile } = require("../helpers/ledger");
const { settle, times } = require("../helpers/concurrency");

beforeEach(resetDatabase);
afterAll(disconnect);

const receive = (po, warehouse, index, quantity) =>
  procurementService.createGoodsReceipt({
    purchaseOrderId: po.id,
    warehouseId: warehouse.id,
    items: [
      {
        purchaseOrderItemId: po.items[index].id,
        productId: po.items[index].productId,
        quantity,
      },
    ],
  });

describe("concurrent goods receipts (D-03, FR-015)", () => {
  it("two parallel receipts of 6 against a PO line of 10: only one succeeds", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({ items: [{ productId: product.id, quantity: 10 }] });

    const { ok, failed } = await settle([receive(po, warehouse, 0, 6), receive(po, warehouse, 0, 6)]);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toBeInstanceOf(ConflictError);
    expect(failed[0].message).toMatch(/Cannot receive 6\. Remaining quantity .* is 4/);

    const item = await prisma.purchaseOrderItem.findUnique({ where: { id: po.items[0].id } });
    expect(item.receivedQuantity).toBe(6);
    expect(await prisma.goodsReceipt.count()).toBe(1);

    const { inventory, rows } = await reconcile(product.id, warehouse.id, 0);
    expect(inventory.quantity).toBe(6);
    expect(rows).toHaveLength(1);
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");
  });

  it("12 parallel receipts of 1 against a PO line of 10: exactly 10 succeed and the PO is RECEIVED", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({ items: [{ productId: product.id, quantity: 10 }] });

    const { ok, failed } = await settle(times(12, () => receive(po, warehouse, 0, 1)));

    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(2);
    failed.forEach((error) => expect(error).toBeInstanceOf(ConflictError));

    const item = await prisma.purchaseOrderItem.findUnique({ where: { id: po.items[0].id } });
    expect(item.receivedQuantity).toBe(10);
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("RECEIVED");

    const { inventory, rows } = await reconcile(product.id, warehouse.id, 0);
    expect(inventory.quantity).toBe(10);
    expect(rows.map((r) => r.balanceAfter)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("receipts for different lines of one PO that together complete it leave the PO RECEIVED", async () => {
    const a = await f.createProduct();
    const b = await f.createProduct();
    const warehouse = await f.createWarehouse();
    const po = await f.createPurchaseOrder({
      items: [
        { productId: a.id, quantity: 5 },
        { productId: b.id, quantity: 5 },
      ],
    });

    const { ok, failed } = await settle([receive(po, warehouse, 0, 5), receive(po, warehouse, 1, 5)]);

    expect(failed).toHaveLength(0);
    expect(ok).toHaveLength(2);
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe("RECEIVED");
  });

  it("receipts racing with manual issues keep stock and ledger consistent", async () => {
    const product = await f.createProduct();
    const warehouse = await f.createWarehouse();
    await f.createInventory({ productId: product.id, warehouseId: warehouse.id, quantity: 20 });
    const po = await f.createPurchaseOrder({ items: [{ productId: product.id, quantity: 50 }] });

    const { failed } = await settle([
      ...times(5, () => receive(po, warehouse, 0, 10)),
      ...times(5, () =>
        inventoryService.issueStock({ productId: product.id, warehouseId: warehouse.id, quantity: 4 })
      ),
    ]);

    expect(failed).toHaveLength(0);
    const { inventory } = await reconcile(product.id, warehouse.id, 20);
    expect(inventory.quantity).toBe(20 + 50 - 20);
  });
});
