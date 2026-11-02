const { Rng, hashString } = require("../../prisma/seed/prng");
const { parseEndDate, weekdayFactor, DAY_MS } = require("../../prisma/seed/config");
const { buildProducts, suppliers, categories, warehouses, company, factory } = require("../../prisma/seed/catalog");

const draw = (rng, n = 20) => Array.from({ length: n }, () => rng.next());

describe("seeded PRNG (SEED-006)", () => {
  it("is deterministic for the same keys", () => {
    expect(draw(new Rng(42, "a", "b"))).toEqual(draw(new Rng(42, "a", "b")));
    expect(hashString("x")).toBe(hashString("x"));
  });

  it("gives unrelated streams for different seeds or keys", () => {
    const base = draw(new Rng(42, "a"));

    expect(draw(new Rng(43, "a"))).not.toEqual(base);
    expect(draw(new Rng(42, "b"))).not.toEqual(base);
  });

  it("stays in [0, 1) and int() is inclusive of both ends", () => {
    const rng = new Rng("range");
    const seen = new Set();

    for (let i = 0; i < 2000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      seen.add(rng.int(3, 6));
    }

    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it("poisson has roughly the right mean, including the large-lambda branch", () => {
    for (const lambda of [0.7, 5, 14, 45]) {
      const rng = new Rng("poisson", lambda);
      const n = 6000;
      const mean = Array.from({ length: n }, () => rng.poisson(lambda)).reduce((a, b) => a + b, 0) / n;

      expect(Math.abs(mean - lambda)).toBeLessThan(Math.max(0.15, lambda * 0.05));
    }

    expect(new Rng("z").poisson(0)).toBe(0);
    expect(new Rng("z").poisson(-3)).toBe(0);
  });

  it("shuffle returns a new array with the same members", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = new Rng("s").shuffle(input);

    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
  });
});

describe("config helpers", () => {
  it("parses a valid end date to UTC midnight and rejects bad ones", () => {
    expect(parseEndDate("2026-11-01")).toBe(Date.UTC(2026, 10, 1));
    expect(() => parseEndDate("2026-02-30")).toThrow(/Invalid end date/);
    expect(() => parseEndDate("11/01/2026")).toThrow(/Invalid end date/);
  });

  it("lowers weekend demand on Friday and Saturday (SEED-002)", () => {
    const friday = Date.UTC(2026, 10, 6);

    expect(new Date(friday).getUTCDay()).toBe(5);
    expect(weekdayFactor(friday)).toBeLessThan(1);
    expect(weekdayFactor(friday + DAY_MS)).toBeLessThan(1);
    expect(weekdayFactor(friday + 2 * DAY_MS)).toBe(1);
  });
});

describe("catalog (SEED-001)", () => {
  const products = buildProducts();

  it("has the required master data sizes", () => {
    expect(company.code).toBe("SYN-DEMO");
    expect(factory.code).toBe("SYN-DHAKA");
    expect(warehouses).toHaveLength(2);
    expect(categories).toHaveLength(3);
    expect(products.length).toBeGreaterThanOrEqual(15);
    expect(products.length).toBeLessThanOrEqual(20);
    expect(suppliers.length).toBeGreaterThanOrEqual(4);
    expect(suppliers.length).toBeLessThanOrEqual(5);
  });

  it("marks everything as seed-owned so replace can find it", () => {
    products.forEach((p) => expect(p.sku.startsWith("SYN-")).toBe(true));
    suppliers.forEach((s) => expect(s.code.startsWith("SYN-")).toBe(true));
    categories.forEach((c) => expect(c.startsWith("[SYN] ")).toBe(true));
    warehouses.forEach((w) => expect(w.code.startsWith("SYN-")).toBe(true));
  });

  it("gives unique SKUs and exactly one preferred supplier per product", () => {
    expect(new Set(products.map((p) => p.sku)).size).toBe(products.length);

    products.forEach((p) => {
      expect(p.supplierOptions.filter((o) => o.isPreferred)).toHaveLength(1);
      expect(p.supplierOptions[0].isPreferred).toBe(true);
    });
  });

  it("varies price, lead time and MOQ across suppliers (AI-005 needs a choice)", () => {
    const withChoice = products.filter((p) => p.supplierOptions.length > 1);

    expect(withChoice.length).toBe(products.length);
    withChoice.forEach((p) => {
      const [a, b] = p.supplierOptions;
      expect(a.supplierCode).not.toBe(b.supplierCode);
      expect(a.leadTimeDays).not.toBe(b.leadTimeDays);
      expect(a.unitPrice).not.toBe(b.unitPrice);
    });

    const usedSuppliers = new Set(products.flatMap((p) => p.supplierOptions.map((o) => o.supplierCode)));
    expect(usedSuppliers.size).toBe(suppliers.length);
  });

  it("derives sane stock policy numbers and money as 2-decimal strings", () => {
    products.forEach((p) => {
      expect(p.reorderLevel).toBeGreaterThan(0);
      expect(p.orderUpTo).toBeGreaterThan(p.reorderLevel);
      expect(p.minStock).toBeLessThan(p.reorderLevel);
      expect(p.price).toMatch(/^\d+\.\d{2}$/);
      p.supplierOptions.forEach((o) => {
        expect(o.unitPrice).toMatch(/^\d+\.\d{2}$/);
        expect(Number(o.unitPrice)).toBeLessThan(Number(p.price));
        expect(o.minimumOrderQty).toBeGreaterThanOrEqual(1);
      });
    });
  });

  it("defines the SEED-007 scenario products", () => {
    const count = (profile) => products.filter((p) => p.profile === profile).length;

    expect(count("NEAR_ROP")).toBe(4);
    expect(count("TREND_FAST")).toBe(1);
    expect(count("OVERSTOCKED")).toBe(1);
    expect(products.filter((p) => p.profile === "TRENDING").length).toBeGreaterThanOrEqual(2);
    expect(products.filter((p) => p.profile === "STABLE").length).toBeGreaterThanOrEqual(2);
  });
});
