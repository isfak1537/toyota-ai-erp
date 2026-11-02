const prisma = require("../config/prisma");

// Writes one AiAuditLog row (AI-011, NFR-004). Pass the caller's transaction client
// as `client` so the log entry commits or rolls back together with the action.
const writeAudit = (client, { eventType, actorUserId = null, payload = {} }) =>
  (client || prisma).aiAuditLog.create({
    data: { eventType, actorUserId, payload },
  });

module.exports = { writeAudit };
