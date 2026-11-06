const defaultPrisma = require("../../config/prisma");
const { hostOf, LOCAL_HOSTS } = require("./demo-prepare");

// Demo helper (AI-009). A stored explanation is the cache: it is generated once per suggestion and reused. To see a
// fresh one (for example after the prompt changed), clear it on the suggestions still waiting for a decision. Only
// explanation and explanationSource of PENDING AiSuggestion rows change; decided suggestions keep their text for the
// audit trail, and anomaly flags are never touched. The numbers of a suggestion are not touched either.
const where = { status: "PENDING", OR: [{ explanation: { not: null } }, { explanationSource: { not: null } }] };

const clearPendingExplanations = async ({ apply = false, allowRemote = false, databaseUrl } = {}, deps = {}) => {
  const db = deps.prisma ?? defaultPrisma;
  const host = hostOf(databaseUrl ?? process.env.DATABASE_URL ?? "");

  if (apply && (host === null || !LOCAL_HOSTS.has(host)) && !allowRemote) {
    throw new Error("Refusing to write: the database host is not local. Pass --allow-remote if that is really intended.");
  }

  if (!apply) return { applied: false, count: await db.aiSuggestion.count({ where }) };

  const count = await db.$transaction(async (tx) => (await tx.aiSuggestion.updateMany({ where, data: { explanation: null, explanationSource: null } })).count);

  return { applied: true, count };
};

module.exports = { clearPendingExplanations };
