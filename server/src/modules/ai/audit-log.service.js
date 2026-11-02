const prisma = require("../../config/prisma");

// ADMIN's view of the AI audit log (F-11, AI-011, NFR-004). The per-series detail a replenishment run
// stores in its payload is left out of the list (it has its own review page); `seriesCount` says how big it was.
const listAuditLog = async ({ eventType, skip, take }) => {
  const where = eventType ? { eventType } : {};

  const [rows, total, types] = await Promise.all([
    prisma.aiAuditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
    prisma.aiAuditLog.count({ where }),
    prisma.aiAuditLog.groupBy({ by: ["eventType"], _count: { _all: true }, orderBy: { eventType: "asc" } }),
  ]);

  const items = rows.map((row) => {
    const { series, ...payload } = row.payload ?? {};

    return { ...row, payload: { ...payload, ...(Array.isArray(series) && { seriesCount: series.length }) } };
  });

  return { items, total, eventTypes: types.map((t) => ({ eventType: t.eventType, count: t._count._all })) };
};

module.exports = { listAuditLog };
