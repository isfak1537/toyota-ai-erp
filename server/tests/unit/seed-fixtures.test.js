const fs = require("fs");
const path = require("path");
const { buildFixtures, FIXTURE_DIR } = require("../../scripts/export-fixtures");

const fixtures = buildFixtures();

describe("AI service fixtures", () => {
  it.each(Object.keys(fixtures))("%s is identical to what the default seed generates", (name) => {
    expect(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")).toBe(fixtures[name]);
  });

  it("never contains the anomaly flags in the ledger the models see", () => {
    const header = fixtures["ledger.csv"].split("\n")[0].split(",");

    expect(header).toEqual(["id", "productId", "warehouseId", "type", "quantity", "balanceAfter", "referenceType", "referenceId", "createdAt"]);
    expect(fixtures["ledger.csv"]).not.toMatch(/anomal/i);
  });

  it("only exposes columns the read-only database role may select", () => {
    // no `reason` column: the role cannot read free text
    expect(fixtures["ledger.csv"].split("\n")[0]).not.toMatch(/reason/);
    expect(fixtures["products.csv"].split("\n")[0]).toBe("id,sku,name");
    expect(fixtures["warehouses.csv"].split("\n")[0]).toBe("id,code,name");
  });

  it("has chronological ids and one row per ledger entry", () => {
    const rows = fixtures["ledger.csv"].trim().split("\n").slice(1);

    expect(rows).toHaveLength(2978);
    rows.forEach((row, i) => expect(Number(row.split(",")[0])).toBe(i + 1));
  });
});
