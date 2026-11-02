const { prisma, resetDatabase, disconnect } = require("../helpers/db");
const { ensureDemoUsers, DEMO_USERS } = require("../../src/services/demo-users");
const bcrypt = require("bcryptjs");

const demoWhere = { email: { endsWith: "@demo.synthetic" } }; // the reset also creates one baseline admin

beforeEach(resetDatabase);
afterAll(disconnect);

const passwords = (suffix = "") => ({
  DEMO_ADMIN_PASSWORD: `admin-password-${suffix}1`,
  DEMO_WAREHOUSE_PASSWORD: `warehouse-pass-${suffix}2`,
  DEMO_PROCUREMENT_PASSWORD: `procurement-pw-${suffix}3`,
  DEMO_VIEWER_PASSWORD: `viewer-password-${suffix}4`,
});

describe("ensureDemoUsers", () => {
  it("creates the four roles with hashed passwords from the environment", async () => {
    await ensureDemoUsers(passwords());
    const users = await prisma.user.findMany({ where: demoWhere, orderBy: { id: "asc" } });

    expect(users.map((u) => u.role)).toEqual(["ADMIN", "WAREHOUSE_MANAGER", "PROCUREMENT_OFFICER", "VIEWER"]);
    expect(await bcrypt.compare(passwords().DEMO_ADMIN_PASSWORD, users[0].passwordHash)).toBe(true);
    expect(users.every((u) => u.isActive && !u.passwordHash.includes("password"))).toBe(true);
  });

  it.each(DEMO_USERS.map((u) => u.env))("refuses to run when %s is missing", async (name) => {
    const env = passwords();
    delete env[name];

    await expect(ensureDemoUsers(env)).rejects.toThrow(name);
    expect(await prisma.user.count({ where: demoWhere })).toBe(0);
  });

  it("refuses passwords shorter than 12 characters and never echoes a password", async () => {
    const env = { ...passwords(), DEMO_VIEWER_PASSWORD: "short-pw" };

    await expect(ensureDemoUsers(env)).rejects.toThrow(/DEMO_VIEWER_PASSWORD/);
    await expect(ensureDemoUsers(env)).rejects.not.toThrow(/short-pw/);
  });

  it("is repeatable: keeps existing passwords unless reset is requested", async () => {
    await ensureDemoUsers(passwords("a"));
    await ensureDemoUsers(passwords("b"));

    const admin = await prisma.user.findUnique({ where: { email: "admin@demo.synthetic" } });
    expect(await prisma.user.count({ where: demoWhere })).toBe(4);
    expect(await bcrypt.compare(passwords("a").DEMO_ADMIN_PASSWORD, admin.passwordHash)).toBe(true);

    await ensureDemoUsers(passwords("b"), { resetPasswords: true });
    const reset = await prisma.user.findUnique({ where: { email: "admin@demo.synthetic" } });
    expect(await bcrypt.compare(passwords("b").DEMO_ADMIN_PASSWORD, reset.passwordHash)).toBe(true);
  });
});
