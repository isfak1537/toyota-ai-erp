const fs = require("fs");
const { buildDataset } = require("../../prisma/seed/build");
const { LABELS_PATH, serializeLabels } = require("../../prisma/seed/labels");

const DAY = 86400000;
const dataset = buildDataset();

// facts about the final state of a series at the main warehouse
const facts = (data, product) => {
  const inv = data.inventory.find((i) => i.sku === product.sku && i.warehouseCode === "SYN-MAIN");
  const end = Date.parse(`${data.meta.endDate}T23:59:59Z`);
  const recentIssued = -data.ledger
    .filter(
      (r) =>
        r.sku === product.sku &&
        r.warehouseCode === "SYN-MAIN" &&
        r.type === "ISSUE" &&
        Date.parse(r.createdAt) > end - 14 * DAY
    )
    .reduce((sum, r) => sum + r.quantity, 0);
  const available = inv.quantity - inv.reservedQuantity;
  const openOrder = data.purchaseOrders.some(
    (po) => po.status === "APPROVED" && po.item.sku === product.sku && po.receivingWarehouseCode === "SYN-MAIN"
  );
  const lead = data.supplierProducts.find((s) => s.sku === product.sku && s.isPreferred).leadTimeDays;

  return { inv, available, cover: available / (recentIssued / 14), openOrder, lead };
};

const scenarioChecks = (data) => {
  const near = data.products.filter((p) => p.profile === "NEAR_ROP").map((p) => ({ p, ...facts(data, p) }));
  const fast = data.products.filter((p) => p.profile === "TREND_FAST").map((p) => ({ p, ...facts(data, p) }));
  const over = data.products.filter((p) => p.profile === "OVERSTOCKED").map((p) => ({ p, ...facts(data, p) }));

  return { near, fast, over };
};

describe("SEED-007 demo scenarios", () => {
  const { near, fast, over } = scenarioChecks(dataset);

  it("has 4 products within 25% of their reorder point, some below, none with an open order", () => {
    expect(near).toHaveLength(4);

    near.forEach(({ p, available, openOrder }) => {
      expect(available / p.reorderLevel).toBeGreaterThanOrEqual(0.8);
      expect(available / p.reorderLevel).toBeLessThanOrEqual(1.25);
      expect(openOrder).toBe(false);
    });

    expect(near.filter(({ p, available }) => available <= p.reorderLevel).length).toBeGreaterThanOrEqual(2);
    expect(near.filter(({ p, available }) => available > p.reorderLevel).length).toBeGreaterThanOrEqual(1);
  });

  it("has one trending product that will run out before a new order could arrive", () => {
    expect(fast).toHaveLength(1);

    const { p, available, cover, lead, openOrder } = fast[0];

    expect(cover).toBeLessThan(lead);
    expect(available).toBeLessThan(p.reorderLevel);
    expect(openOrder).toBe(false);
    expect(p.trend).toBeGreaterThan(1);
  });

  it("has one over-stocked product with months of cover, above its maximum stock", () => {
    expect(over).toHaveLength(1);

    const { p, available, cover } = over[0];

    expect(cover).toBeGreaterThan(60);
    expect(available).toBeGreaterThan(p.maxStock);
  });

  it("shows 2-3 anomalies in the last ten days", () => {
    const visible = dataset.anomalyLabels.anomalies.filter((a) => a.visibleInDemo);

    expect(visible.length).toBeGreaterThanOrEqual(2);
    expect(visible.length).toBeLessThanOrEqual(3);
  });

  it("holds for other seeds too (the steering does not depend on luck)", () => {
    for (const seed of [1, 2, 3, 7, 42, 99, 555, 2026, 31337]) {
      const data = buildDataset({ seed });
      const s = scenarioChecks(data);

      s.near.forEach(({ p, available, openOrder }) => {
        expect(available / p.reorderLevel).toBeGreaterThanOrEqual(0.8);
        expect(available / p.reorderLevel).toBeLessThanOrEqual(1.25);
        expect(openOrder).toBe(false);
      });
      expect(s.fast[0].cover).toBeLessThan(s.fast[0].lead);
      expect(s.fast[0].openOrder).toBe(false);
      expect(s.over[0].cover).toBeGreaterThan(60);
      expect(data.anomalyLabels.anomalies.filter((a) => a.visibleInDemo).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("SEED-004 injected anomalies", () => {
  const { anomalies } = dataset.anomalyLabels;
  const find = (label) =>
    dataset.ledger.filter(
      (r) =>
        r.sku === label.sku &&
        r.warehouseCode === label.warehouseCode &&
        r.createdAt === label.occurredAt &&
        r.type === label.ledgerType &&
        r.quantity === label.quantity
    );

  it("has between 5 and 10 labelled anomalies of at least four kinds", () => {
    expect(anomalies.length).toBeGreaterThanOrEqual(5);
    expect(anomalies.length).toBeLessThanOrEqual(10);
    expect(dataset.anomalyLabels.count).toBe(anomalies.length);
    expect(new Set(anomalies.map((a) => a.anomalyType)).size).toBeGreaterThanOrEqual(4);
  });

  it("matches every label to exactly one real ledger row by its natural key", () => {
    anomalies.forEach((label) => expect(find(label)).toHaveLength(1));
  });

  it("marks only the injected rows (a duplicate has an original) and nothing else", () => {
    const marked = dataset.ledger.filter((r) => r.anomalyId !== null);
    const ids = new Set(marked.map((r) => r.anomalyId));

    expect(ids.size).toBe(anomalies.length);
    expect(marked.length).toBe(anomalies.length + anomalies.filter((a) => a.related).length);
  });

  it("makes each kind of anomaly look like what its label says", () => {
    const issuesOf = (label) =>
      dataset.ledger.filter((r) => r.sku === label.sku && r.warehouseCode === label.warehouseCode && r.type === "ISSUE" && r.anomalyId === null);
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

    for (const label of anomalies) {
      const hour = new Date(label.occurredAt).getUTCHours();

      switch (label.anomalyType) {
        case "SPIKE_ISSUE":
          expect(-label.quantity).toBeGreaterThanOrEqual(4 * -median(issuesOf(label).map((r) => r.quantity)));
          expect(hour >= 2 && hour < 11).toBe(true);
          break;
        case "NEGATIVE_ADJUSTMENT":
          expect(label.ledgerType).toBe("ADJUSTMENT");
          expect(label.quantity).toBeLessThanOrEqual(-5);
          break;
        case "OFF_HOURS_ISSUE":
          expect(hour >= 19 && hour < 22).toBe(true);
          break;
        case "DUPLICATE_ISSUE": {
          expect(label.related).not.toBeNull();
          expect(label.related.quantity).toBe(label.quantity);
          expect(Date.parse(label.occurredAt) - Date.parse(label.related.occurredAt)).toBe(3 * 60000);
          break;
        }
        case "MANUAL_RECEIPT": {
          const row = find(label)[0];

          expect(row.type).toBe("RECEIPT");
          expect(row.referenceType).toBe("MANUAL_RECEIPT");
          expect(row.reference).toBeNull();
          break;
        }
        default:
          throw new Error(`unexpected anomaly type ${label.anomalyType}`);
      }
    }
  });

  it("tells P3 which detector should catch each anomaly and how severe it is", () => {
    anomalies.forEach((a) => {
      expect(["RULE", "MODEL", "BOTH"]).toContain(a.expectedDetection);
      expect(["HIGH", "MEDIUM"]).toContain(a.severity);
      expect(typeof a.description).toBe("string");
    });
  });

  it("keeps the committed anomaly-labels.json identical to what the default seed generates", () => {
    expect(fs.readFileSync(LABELS_PATH, "utf8")).toBe(serializeLabels(dataset.anomalyLabels));
  });

  it("documents the time convention next to the labels", () => {
    expect(dataset.anomalyLabels.timezoneOffsetHours).toBe(6);
    expect(dataset.anomalyLabels.businessHoursUtc).toBe("02:00-11:00");
  });
});
