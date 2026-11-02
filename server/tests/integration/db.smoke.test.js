const { prisma, resetDatabase, disconnect } = require("../helpers/db");

beforeEach(resetDatabase);
afterAll(disconnect);

describe("test database harness", () => {
  it("is connected to a *_test database that is not the dev database", async () => {
    const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;

    expect(name.endsWith("_test")).toBe(true);
  });

  it("has all committed migrations applied", async () => {
    const rows = await prisma.$queryRaw`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;

    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it("truncates data and restarts identity between tests", async () => {
    const first = await prisma.company.create({ data: { name: "A", code: "A" } });
    expect(first.id).toBe(1);

    await resetDatabase();

    expect(await prisma.company.count()).toBe(0);

    const second = await prisma.company.create({ data: { name: "B", code: "B" } });
    expect(second.id).toBe(1);
  });

  it("keeps _prisma_migrations when truncating", async () => {
    await resetDatabase();

    const [{ count }] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count FROM _prisma_migrations
    `;

    expect(count).toBeGreaterThanOrEqual(7);
  });
});
