-- Read-only database role for the AI service (CLAUDE.md: the AI never writes
-- business records). Run it yourself, once, as the database owner or a superuser:
--
--   psql -d toyota_erp -f ai-service/sql/create_ai_readonly_role.sql
--
-- Replace CHANGE_ME before running and put the same password in
-- ai-service/.env (AI_DB_URL). Never commit the password.
--
-- Least privilege: column-level SELECT on the three tables the models read.
-- The service therefore never uses SELECT * (it would be refused), and it
-- cannot read free-text columns such as InventoryTransaction.reason.

CREATE ROLE ai_readonly WITH LOGIN PASSWORD 'CHANGE_ME'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- every session of this role is read-only, whatever the client asks for
ALTER ROLE ai_readonly SET default_transaction_read_only = on;
ALTER ROLE ai_readonly SET statement_timeout = '30s';

GRANT CONNECT ON DATABASE toyota_erp TO ai_readonly;
GRANT USAGE ON SCHEMA public TO ai_readonly;
REVOKE CREATE ON SCHEMA public FROM ai_readonly;

GRANT SELECT ("id", "productId", "warehouseId", "type", "quantity", "balanceAfter",
              "referenceType", "referenceId", "createdAt")
  ON "InventoryTransaction" TO ai_readonly;
GRANT SELECT ("id", "sku", "name") ON "Product" TO ai_readonly;
GRANT SELECT ("id", "code", "name") ON "Warehouse" TO ai_readonly;

-- To undo:
--   REVOKE ALL ON "InventoryTransaction", "Product", "Warehouse" FROM ai_readonly;
--   REVOKE ALL ON SCHEMA public FROM ai_readonly;
--   REVOKE ALL ON DATABASE toyota_erp FROM ai_readonly;
--   DROP ROLE ai_readonly;
