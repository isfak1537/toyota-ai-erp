const prisma = require("../../config/prisma");
const { ConflictError, NotFoundError } = require("../../errors/app-error");
const { writeAudit } = require("../../services/audit.service");
const { makeNumber } = require("../../services/procurement.service");
const { suggestionInclude } = require("./replenishment.service");

const requisitionInclude = { supplier: true, destinationWarehouse: true, items: { include: { product: true } } };

// Locks the suggestion row for the rest of the transaction, so concurrent decisions on one
// suggestion run one after another and the second sees the first one's result.
const lockSuggestion = async (tx, id) => {
  const rows = await tx.$queryRaw`
    SELECT "id", "status", "requisitionId" FROM "AiSuggestion"
    WHERE "id" = ${id}::int
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundError("AI suggestion not found");
  }

  return rows[0];
};

// AI-007. The only place in the system where AI output becomes a business record, and only
// because a human asked for it. One transaction: lock the suggestion, create the DRAFT
// requisition, link it, mark the suggestion APPROVED, audit. Approving again returns the same
// requisition (idempotent); approving a rejected or expired suggestion is a 409.
const approveSuggestion = async (id, actor) =>
  prisma.$transaction(async (tx) => {
    const locked = await lockSuggestion(tx, id);

    if (locked.status === "APPROVED") {
      const [suggestion, requisition] = await Promise.all([
        tx.aiSuggestion.findUnique({ where: { id }, include: suggestionInclude }),
        tx.purchaseRequisition.findUnique({ where: { id: locked.requisitionId }, include: requisitionInclude }),
      ]);

      return { suggestion, requisition, idempotent: true };
    }

    if (locked.status !== "PENDING") {
      throw new ConflictError(`Only PENDING suggestions can be approved (this one is ${locked.status})`);
    }

    const suggestion = await tx.aiSuggestion.findUnique({ where: { id } });

    // the world may have changed since the run: refuse instead of ordering from a dead supplier
    const link = await tx.supplierProduct.findUnique({
      where: { supplierId_productId: { supplierId: suggestion.supplierId, productId: suggestion.productId } },
      include: { supplier: true, product: true },
    });

    if (!link || !link.supplier.isActive) {
      throw new ConflictError("The suggested supplier is no longer active for this product; run replenishment again");
    }

    if (!link.product.isActive) {
      throw new ConflictError("The product is no longer active");
    }

    const warehouse = await tx.warehouse.findUnique({ where: { id: suggestion.warehouseId } });

    if (!warehouse?.isActive) {
      throw new ConflictError("The destination warehouse is no longer active");
    }

    const requisition = await tx.purchaseRequisition.create({
      data: {
        requisitionNumber: makeNumber("PR"),
        requesterName: actor.name,
        supplierId: suggestion.supplierId,
        destinationWarehouseId: suggestion.warehouseId,
        status: "DRAFT",
        notes: `Created from AI suggestion #${suggestion.id} (run ${suggestion.runId}, model ${suggestion.modelVersion})`,
        createdById: actor.id,
        sourceType: "AI_SUGGESTION",
        sourceId: suggestion.id,
        items: {
          create: [{ productId: suggestion.productId, quantity: suggestion.suggestedQty, estimatedUnitPrice: link.unitPrice }],
        },
      },
      include: requisitionInclude,
    });

    // belt and braces next to the row lock: only a PENDING row can move to APPROVED
    const claimed = await tx.aiSuggestion.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", decidedById: actor.id, decidedAt: new Date(), requisitionId: requisition.id },
    });

    if (claimed.count !== 1) {
      throw new ConflictError("The suggestion changed while it was being approved");
    }

    await writeAudit(tx, {
      eventType: "SUGGESTION_APPROVED",
      actorUserId: actor.id,
      payload: {
        suggestionId: suggestion.id,
        requisitionId: requisition.id,
        productId: suggestion.productId,
        warehouseId: suggestion.warehouseId,
        supplierId: suggestion.supplierId,
        quantity: suggestion.suggestedQty,
        modelVersion: suggestion.modelVersion,
      },
    });

    return {
      suggestion: await tx.aiSuggestion.findUnique({ where: { id }, include: suggestionInclude }),
      requisition,
      idempotent: false,
    };
  });

const rejectSuggestion = async (id, reason, actor) =>
  prisma.$transaction(async (tx) => {
    const locked = await lockSuggestion(tx, id);

    if (locked.status === "REJECTED") {
      return { suggestion: await tx.aiSuggestion.findUnique({ where: { id }, include: suggestionInclude }), idempotent: true };
    }

    if (locked.status !== "PENDING") {
      throw new ConflictError(`Only PENDING suggestions can be rejected (this one is ${locked.status})`);
    }

    const suggestion = await tx.aiSuggestion.update({
      where: { id },
      data: { status: "REJECTED", rejectReason: reason, decidedById: actor.id, decidedAt: new Date() },
      include: suggestionInclude,
    });

    await writeAudit(tx, {
      eventType: "SUGGESTION_REJECTED",
      actorUserId: actor.id,
      payload: { suggestionId: id, reason },
    });

    return { suggestion, idempotent: false };
  });

module.exports = { approveSuggestion, rejectSuggestion };
