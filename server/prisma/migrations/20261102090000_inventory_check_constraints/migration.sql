-- Defense in depth for stock integrity (FR-005..FR-012, NFR-003, D-02).
-- Application code already enforces these through the conditional UPDATE in
-- inventory.repository.applyDelta; the database now refuses any write path
-- (raw SQL, seed scripts, future code) that would break the invariant:
--   0 <= reservedQuantity <= quantity
-- Prisma does not model CHECK constraints, so they live only in this migration.

ALTER TABLE "Inventory"
  ADD CONSTRAINT "Inventory_quantity_non_negative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "Inventory_reserved_non_negative" CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT "Inventory_reserved_lte_quantity" CHECK ("reservedQuantity" <= "quantity");
