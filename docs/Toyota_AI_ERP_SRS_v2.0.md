**TOYOTA AI ERP**

SOFTWARE REQUIREMENTS SPECIFICATION

*System behavior, AI core, interfaces, data, security and quality
requirements*

| **Item**   | **Detail**                                                                           |
|------------|--------------------------------------------------------------------------------------|
| Project    | AI-Powered ERP Platform for Manufacturing                                            |
| Version    | 2.0 — Final MVP Baseline                                                             |
| Date       | 2 November 2026                                                                      |
| Supersedes | Version 1.0 — Consolidated Draft (2 November 2026)                                   |
| Status     | Final working baseline for the MVP demo release; formal stakeholder approval pending |

**CONFIDENTIAL — PROJECT WORKING DOCUMENT**

# 1. Introduction

## 1.1 Purpose

This SRS defines the functional and non-functional requirements for the
Toyota AI ERP Platform and guides architecture, implementation, testing
and acceptance. Version 2.0 adds the requirements for the MVP demo
release (Inventory & Procurement + AI Core) and records known defects
found in a code review of the current codebase.

## 1.2 Scope

The full system provides web interfaces and backend APIs for
organization, master data, inventory, procurement, sales, manufacturing,
finance, HR, reporting and AI/IoT capabilities. The **MVP release**
implements organization and master data, inventory, procurement, minimal
authentication, the AI Core and a web interface. Each requirement below
is tagged with its release.

## 1.3 Release tags

| **Tag**      | **Meaning**                                                   |
|--------------|---------------------------------------------------------------|
| MVP          | Required for the MVP demo release                             |
| MVP-Existing | Already implemented; must be verified and hardened in the MVP |
| Later        | Roadmap; not part of the MVP                                  |

## 1.4 Terms

**Definitions**

| **Term**              | **Meaning**                                                                                            |
|-----------------------|--------------------------------------------------------------------------------------------------------|
| ERP / SKU / BOM / MRP | Enterprise Resource Planning / Stock Keeping Unit / Bill of Materials / Material Requirements Planning |
| RBAC                  | Role-Based Access Control                                                                              |
| Ledger                | Chronological record of stock movements (InventoryTransaction)                                         |
| Available stock       | On-hand quantity minus reserved quantity                                                               |
| On-order quantity     | Approved purchase order quantity not yet received                                                      |
| Lead time (L)         | Days between ordering from a supplier and receiving goods                                              |
| Safety stock (SS)     | Extra stock held to cover demand uncertainty during lead time                                          |
| Reorder point (ROP)   | Stock level at which a replenishment order should be placed                                            |
| MAE                   | Mean absolute error — average size of forecast errors                                                  |
| Baseline model        | Simple moving-average forecast used to judge whether the ML model adds value                           |
| Anomaly               | A stock transaction that is statistically or logically unusual                                         |
| LLM                   | Large language model, used only for explanations and natural-language questions                        |
| Human-in-the-loop     | A person must approve an AI recommendation before it affects business records                          |
| Atomic transaction    | All database changes commit, or all roll back                                                          |

# 2. Overall System Description

## 2.1 Product perspective

React/TypeScript web client; Node.js/Express REST API; PostgreSQL via
Prisma; a separate Python FastAPI service for ML models; an external
free LLM API accessed through a provider abstraction. The ERP backend is
a modular monolith organized as routes → controllers → services →
repositories.

React client (Vercel)

│ HTTPS /api/v1

Node.js / Express ERP API ───────────── PostgreSQL (Neon)

├── business modules ▲

├── ai module (replenishment, LLM, │ read-only DB role

│ suggestions, audit) │

└── ai.client ──────────► Python AI service (FastAPI)

├── forecasting model

└── anomaly model

LLM provider ───────────► Groq (primary) / Gemini (fallback) / Ollama
(local dev)

## 2.2 User classes

**MVP roles**

| **Role (MVP code)** | **MVP access**                                                                  |
|---------------------|---------------------------------------------------------------------------------|
| ADMIN               | All MVP functions; user management; model retraining; AI audit log              |
| WAREHOUSE_MANAGER   | Inventory operations, ledger, transfers, goods receipt, anomaly review          |
| PROCUREMENT_OFFICER | Suppliers, requisitions, purchase orders, goods receipt, AI suggestion approval |
| VIEWER              | Read-only dashboards, forecasts, suggestions, anomalies; AI assistant           |

Long-term roles (Executive, Factory Manager, Sales, Production, Quality,
HR, Accountant) remain as defined in v1.0 and are tagged Later.

## 2.3 Operating constraints

- Zero-cost operation using free tiers only; free-tier limits must be
  verified at deployment and can change.

- Demo data is synthetic; no real company or personal data is sent to
  external AI APIs.

- The system must run fully on a local machine (localhost) as well as on
  the free deployment.

# 3. Architecture and Interfaces

**Architecture baseline**

| **Layer**      | **Technology / responsibility**                                                                            |
|----------------|------------------------------------------------------------------------------------------------------------|
| Presentation   | React, TypeScript, Vite; responsive web UI; charts for forecasts                                           |
| API            | Node.js, Express 5; REST under /api/v1; JWT authentication                                                 |
| Validation     | Zod schemas for every write endpoint; server-side business validation                                      |
| Business logic | Module services; transaction orchestration; idempotency and concurrency control                            |
| Data access    | Repository layer and Prisma ORM (PostgreSQL adapter)                                                       |
| Database       | PostgreSQL (local or Neon free tier)                                                                       |
| AI service     | Python 3, FastAPI, pandas, scikit-learn, joblib; read-only DB access                                       |
| LLM            | OpenAI-compatible provider abstraction; Groq primary, Gemini fallback, Ollama for local development        |
| Hosting        | Vercel (client and API); AI service on Vercel Python or Render free tier, decided after a bundle-size test |

# 4. Functional Requirements — ERP Core

**ERP functional requirements**

| **ID**     | **Area**                                    | **Requirement**                                                                                                                                 | **Release**                     |
|------------|---------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| FR-001     | Organization                                | Create, retrieve, update and deactivate companies, factories and warehouses.                                                                    | MVP-Existing                    |
| FR-002     | Product                                     | Maintain product master data including SKU, optional barcode, unit, price and stock-control attributes.                                         | MVP-Existing                    |
| FR-003     | Supplier                                    | Maintain supplier profiles and active/inactive state.                                                                                           | MVP-Existing                    |
| FR-004     | Supplier-product                            | Maintain supplier SKU, unit price, lead time, MOQ and preferred-supplier designation.                                                           | MVP-Existing                    |
| FR-005     | Inventory                                   | Maintain inventory balances by product and warehouse.                                                                                           | MVP-Existing                    |
| FR-006     | Receipt                                     | Increase stock through validated receipt operations and create ledger records.                                                                  | MVP-Existing                    |
| FR-007     | Issue                                       | Issue only sufficient available stock and create ledger records, safely under concurrent requests.                                              | MVP-Existing (fix D-02)         |
| FR-008     | Adjustment                                  | Support authorized stock adjustments with reason and ledger record.                                                                             | MVP-Existing                    |
| FR-009     | Reservation                                 | Reserve available stock and prevent duplicate reservation for the same request.                                                                 | MVP-Existing                    |
| FR-010     | Release                                     | Release eligible reserved quantities and record the operation.                                                                                  | MVP-Existing                    |
| FR-011     | Transfer                                    | Transfer stock between warehouses atomically and record both movement sides.                                                                    | MVP-Existing                    |
| FR-012     | Low stock                                   | Identify products below configured reorder/minimum thresholds.                                                                                  | MVP-Existing                    |
| FR-013     | Requisition                                 | Create, submit, retrieve and approve purchase requisitions; record who approved.                                                                | MVP-Existing                    |
| FR-014     | Purchase order                              | Create and manage supplier purchase orders, items, pricing, tax and status.                                                                     | MVP-Existing                    |
| FR-015     | Goods receipt                               | Record quantities against PO items and update inventory atomically; never exceed ordered quantity, even under concurrent receipts.              | MVP-Existing (fix D-03)         |
| FR-016     | Purchase invoice                            | Record supplier invoices, totals and payment state.                                                                                             | MVP-Existing                    |
| FR-017–024 | Sales & CRM                                 | Customers, sales orders, warehouse assignment, reservation on confirmation, delivery, sales invoice, payment, receivables (as defined in v1.0). | FR-017/018 existing; rest Later |
| FR-025–030 | Mfg, MRP, maintenance, quality, HR, finance | As defined in v1.0.                                                                                                                             | Later                           |
| FR-031     | Reporting                                   | Role-appropriate dashboards (MVP: inventory and AI dashboards).                                                                                 | MVP                             |
| FR-032     | RBAC                                        | Enforce authentication and role checks on protected operations (MVP: 4 roles).                                                                  | MVP                             |
| FR-034     | IoT                                         | Ingest authorized telemetry through defined interfaces.                                                                                         | Later                           |

# 5. Functional Requirements — AI Core

**AI functional requirements**

| **ID** | **Requirement**                                                                                                                                                                                                                                                                    | **Release**  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| AI-001 | The AI service shall build daily demand series per product and warehouse from ISSUE ledger records, filling days without issues with zero.                                                                                                                                         | MVP          |
| AI-002 | The AI service shall produce a daily demand forecast for a configurable horizon (default 30 days) with an uncertainty estimate (standard deviation) using (a) a moving-average baseline and (b) a trained ML regressor with calendar and lag features.                             | MVP          |
| AI-003 | The AI service shall evaluate both models on the last 14 days (holdout) and store MAE for each, the model version and training time. The ML model shall be used for replenishment for every series with at least 28 days of history, and the baseline for shorter series (see the note below the table).                                                                     | MVP          |
| AI-004 | The ERP API shall compute replenishment as: SS = z × σ × √L (z = 1.65 by default); ROP = d × L + SS; if available ≤ ROP then qty = max(MOQ, ceil(d × (L + reviewDays) + SS − available − onOrder)). All inputs shall be stored with the suggestion.                                | MVP          |
| AI-005 | Supplier selection: preferred active supplier for the product; otherwise the lowest unit price among active suppliers. Lead time and MOQ come from the selected SupplierProduct.                                                                                                   | MVP          |
| AI-006 | Suggestions shall have status PENDING, APPROVED, REJECTED or EXPIRED. At most one PENDING suggestion may exist per product and warehouse; a new run expires older pending ones.                                                                                                    | MVP          |
| AI-007 | Approving a suggestion shall, in one database transaction, create a DRAFT purchase requisition with the suggested supplier and quantity, link it to the suggestion, set status APPROVED and record the approving user and time. Approving twice shall not create two requisitions. | MVP          |
| AI-008 | The AI service shall score stock transactions for anomalies using an Isolation Forest model plus rules (e.g. large negative adjustment, quantity far above the product's normal range, activity at unusual hours). Each flag shall include a score and a human-readable reason.    | MVP          |
| AI-009 | The ERP API shall request a short LLM explanation for each suggestion and anomaly from the computed facts only, cache it, and show "explanation unavailable" if the LLM fails, without failing the suggestion.                                                                     | MVP          |
| AI-010 | The AI assistant shall answer natural-language questions using read-only data tools only (e.g. low stock, forecast, suggestions, anomalies). It shall have no tools that create, update or delete records, and shall say when it cannot answer from available data.                | MVP (Should) |
| AI-011 | Every suggestion run, LLM call (provider, model, success/failure) and human decision shall be written to an AI audit log.                                                                                                                                                          | MVP          |
| AI-012 | LLM provider, model, API key and fallback order shall be configurable through environment variables without code changes.                                                                                                                                                          | MVP          |
| AI-013 | An administrator shall be able to retrain models; retraining shall not interrupt serving the previous model.                                                                                                                                                                       | MVP (Could)  |
| AI-014 | Supplier-risk scoring, predictive maintenance, expense anomaly detection, IoT analytics.                                                                                                                                                                                           | Later        |

**Note on AI-003 (rule changed 2 Nov 2026, with the evidence).** The first version of AI-003 said to use, per series, the model with the
lower holdout MAE. It was replaced after evaluation on the synthetic dataset (24 product-warehouse series, holdout 2026-10-19 to
2026-11-01, MAE in units per day, mean over series):

| Policy | Holdout MAE |
|---|---|
| Moving-average baseline | 1.536 |
| ML model (the AI-003 policy: ML from 28 days of history) | 1.317 |
| Old rule: lower holdout MAE per series | 1.294 |
| Old rule, nested estimate | 1.414 |

The old rule's 1.294 is optimistic because each winner is picked on the 14 days it is then scored on. In the nested estimate the choice is
made on the preceding 14 days and scored on the untouched holdout; it gives 1.414, worse than using the ML model alone, and the old and the
nested choice agreed on only 38% of series. The ML model is 14.3% better than the baseline overall (and better on 18 of 24 series). The
figures come from synthetic data and must be re-measured on real data; the full results are in `ai-service/REPORT.md`.

# 6. Functional Requirements — Web Interface and Authentication

| **ID**   | **Requirement**                                                                                                                                      | **Release**  |
|----------|------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| UI-001   | Login page; session via JWT; logout.                                                                                                                 | MVP          |
| UI-002   | Inventory dashboard: per product/warehouse on-hand, reserved, available, reorder level, forecast days-of-cover, low-stock highlight.                 | MVP          |
| UI-003   | Product forecast view: chart of last 90 days of demand, baseline and ML forecast, and model MAE.                                                     | MVP          |
| UI-004   | AI suggestions page: list, inputs, explanation, approve/reject (role-restricted).                                                                    | MVP          |
| UI-005   | Anomalies page: list with score, reason, transaction link and review action.                                                                         | MVP          |
| UI-006   | Procurement pages: requisitions, purchase orders, goods receipts with workflow actions.                                                              | MVP          |
| UI-007   | Stock ledger page with product, warehouse, type and date filters and pagination.                                                                     | MVP          |
| UI-008   | AI assistant chat panel.                                                                                                                             | MVP (Should) |
| UI-009   | Consistent loading, empty and error states; clear validation messages.                                                                               | MVP          |
| AUTH-001 | Users have one MVP role; passwords stored as secure hashes; protected endpoints reject missing or invalid tokens (401) and insufficient roles (403). | MVP          |
| AUTH-002 | Approval and stock-changing actions record the acting user.                                                                                          | MVP          |

# 7. Business Rules and State Constraints

- Available stock = on-hand quantity − reserved quantity.

- A stock issue must not make on-hand quantity negative or consume stock
  reserved for another operation.

- Stock-changing operations must update inventory and ledger in the same
  database transaction.

- **Concurrency rule:** stock changes must use atomic conditional
  updates (e.g. update … where quantity − reserved ≥ requested) or row
  locks, not read-then-write calculations in application code.

- Goods receipt validation of remaining PO quantity must happen inside
  the same transaction that updates received quantity.

- Purchase orders created from a requisition: for each requisition item,
  the quantities in non-cancelled purchase orders may not exceed the
  requisition quantity. The check runs under a lock on the requisition so
  concurrent orders cannot exceed it (FR-014).

- A warehouse must be active and valid for stock operations.

- Financial totals must use decimal types and decimal arithmetic;
  rounding and tax rules require finance approval.

- Protected operations must be authorized server-side.

- **AI rules:** AI components never write business records directly;
  only an approved suggestion creates a DRAFT requisition through the
  ERP API. LLM output is never used as a number in calculations.

- Sales rules from v1.0 (reservation on confirmation, delivery limits,
  cancellation release, payment limits) remain for the Later release.

# 8. Data Requirements

Existing entities: Company, Factory, Warehouse, Category, Product,
Supplier, SupplierProduct, Inventory, InventoryTransaction,
StockTransfer(+Item), PurchaseRequisition(+Item), PurchaseOrder(+Item),
GoodsReceipt(+Item), PurchaseInvoice(+Item), Customer,
SalesOrder(+Item). The Prisma schema remains the source of truth.

**New and changed entities**

| **Entity (new)** | **Key fields**                                                                                                                                                                                                               | **Notes**                                                                       |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| User             | id, name, email (unique), passwordHash, role, isActive, createdAt                                                                                                                                                            | MVP roles enum                                                                  |
| AiSuggestion     | id, productId, warehouseId, supplierId, suggestedQty, forecastDaily, sigma, leadTimeDays, safetyStock, reorderPoint, available, onOrder, modelVersion, explanation, status, decidedById, decidedAt, requisitionId, createdAt | Partial unique: one PENDING per product+warehouse (enforced in service + index) |
| AnomalyFlag      | id, inventoryTransactionId (unique), score, reason, source (MODEL/RULE), status (OPEN/REVIEWED), reviewedById, reviewNote, createdAt                                                                                         | One flag per transaction                                                        |
| AiModelRun       | id, modelType (FORECAST/ANOMALY), version, metrics (JSON), trainedAt, isActive                                                                                                                                               | Stores MAE and detection results                                                |
| AiAuditLog       | id, eventType, actorUserId (nullable), payload (JSON), createdAt                                                                                                                                                             | Suggestion runs, LLM calls, decisions                                           |
| (changes)        | InventoryTransaction.createdById, PurchaseRequisition.approvedById, AI source reference on requisition                                                                                                                       | Actor attribution                                                               |

**As built in P4 (3 Nov 2026).** Additions beyond the table above:

- `PurchaseRequisition.destinationWarehouseId` and `PurchaseOrder.destinationWarehouseId` (nullable, on the header). A purchase order inherits the destination of its requisition; naming a different one is a 400. A goods receipt defaults to the order's destination; receiving elsewhere is a 400 unless `allowDifferentWarehouse` is set by an ADMIN or WAREHOUSE_MANAGER, and is then written to the audit log (`GOODS_RECEIPT_WAREHOUSE_OVERRIDE`).
- `InventoryTransaction.reservedAfter` (reserved quantity after the movement, like `balanceAfter`; NULL on rows older than P4). `npm run reconcile` checks that the newest non-null value equals `Inventory.reservedQuantity`.
- `createdById` also on `GoodsReceipt` and `PurchaseRequisition`, `approvedById` also on `PurchaseOrder`, `sourceType`/`sourceId` on `PurchaseRequisition` (`AI_SUGGESTION` and the suggestion id).
- `AiSuggestion` also stores `zValue`, `reviewDays`, `minimumOrderQty`, `onOrderMethod` (`DESTINATION`, `DEMAND_SHARE`, `DESTINATION+DEMAND_SHARE` or `NONE`), `forecastModel`, `runId`, `rejectReason`, `explanationSource` and an `inputs` JSON with every calculation input, including the unrounded onOrder. `onOrder` is open purchase-order quantity addressed to the warehouse plus a demand-share portion of orders without a destination, **floored** so the system never assumes more stock is coming than is certain.
- `AnomalyFlag.source` is `MODEL`, `RULE` or `BOTH`, with `ruleCodes`, `queueRank`, `period`, `topFeatures` and the explanation. Rule hits (`ruleCodes` not empty) and the weekly review queue (`queueRank` not null) are separate lists.
- Replenishment defaults (decided 2 Nov 2026): z = 1.65 and a 7-day review period (`REPLEN_Z`, `REPLEN_REVIEW_DAYS`), stored with every suggestion.
- `AiAuditLog.eventType` values in use: `REPLENISHMENT_RUN`, `SUGGESTION_APPROVED`, `SUGGESTION_REJECTED`, `ANOMALY_SYNC`, `ANOMALY_REVIEWED`, `MODEL_RETRAIN`, `LLM_CALL`, `LLM_SKIPPED`, `ASSISTANT_QUESTION`, `GOODS_RECEIPT_WAREHOUSE_OVERRIDE`.

# 9. API and External Interface Requirements

- Business APIs versioned under /api/v1 with a consistent response
  envelope: { success, data, message, errors }.

- All write requests validated with Zod; validation errors return 400
  with field details.

- Error classes map to status codes centrally (400 malformed input or
  static validation rule; 401; 403; 404; 409 duplicate or state
  conflict; 500); no status codes derived from message text.

- List endpoints support pagination (page, pageSize ≤ 100) and filters.

**MVP API additions**

| **Method & path**                                                       | **Purpose**                                    | **Role**                   |
|-------------------------------------------------------------------------|------------------------------------------------|----------------------------|
| POST /api/v1/auth/login                                                 | Obtain JWT                                     | Public                     |
| GET /api/v1/ai/forecast/:productId?warehouseId=                         | History, baseline and ML forecast              | All                        |
| POST /api/v1/ai/replenishment/run                                       | Generate suggestions                           | PROCUREMENT_OFFICER, ADMIN |
| GET /api/v1/ai/suggestions?status=                                      | List suggestions                               | All                        |
| POST /api/v1/ai/suggestions/:id/approve                                 | Approve → draft requisition                    | PROCUREMENT_OFFICER, ADMIN |
| POST /api/v1/ai/suggestions/:id/reject                                  | Reject with reason                             | PROCUREMENT_OFFICER, ADMIN |
| GET /api/v1/ai/anomalies?status=                                        | List anomaly flags                             | All                        |
| POST /api/v1/ai/anomalies/:id/review                                    | Mark reviewed with note                        | WAREHOUSE_MANAGER, ADMIN   |
| POST /api/v1/ai/ask                                                     | AI assistant question                          | All                        |
| GET /api/v1/ai/models                                                   | Model runs and metrics                         | All                        |
| POST /api/v1/ai/models/retrain                                          | Retrain models                                 | ADMIN                      |
| POST /api/v1/ai/suggestions/:id/explain                                 | Generate the LLM explanation if missing        | PROCUREMENT_OFFICER, ADMIN |
| POST /api/v1/ai/anomalies/sync                                          | Score a window, store/refresh anomaly flags    | WAREHOUSE_MANAGER, ADMIN   |
| GET /api/v1/ai/anomalies?status=&kind=rule\|queue                       | Rule hits or weekly review queue               | All                        |
| POST /api/v1/ai/anomalies/:id/explain                                   | Generate the LLM explanation if missing        | WAREHOUSE_MANAGER, ADMIN   |
| GET /api/v1/auth/me                                                     | The logged-in user                             | All                        |
| Python: GET /health, POST /forecast, POST /anomalies/score, POST /train | Internal AI service API (shared secret header) | ERP API only               |

**Role matrix as built (P4; proposal for the open item in section 15).** Every `/api/v1` route except `POST /auth/login` needs a valid token (401). Reads are open to every role. Writes: master data (company, factory, warehouse, product, customer, sales order) ADMIN; stock operations and transfers ADMIN, WAREHOUSE_MANAGER; suppliers, supplier products, requisitions, purchase orders, invoices, replenishment runs and suggestion decisions ADMIN, PROCUREMENT_OFFICER; goods receipts ADMIN, WAREHOUSE_MANAGER, PROCUREMENT_OFFICER; anomaly sync and review ADMIN, WAREHOUSE_MANAGER; retraining ADMIN; the assistant (`POST /ai/ask`, read-only tools) every role. Insufficient role is 403. The AI service being down or the LLM failing gives 503 on AI routes only (`explanation: null`, `answer: null`); ERP routes are unaffected (NFR-014).

# 10. Non-Functional Requirements

**Quality requirements**

| **ID**  | **Attribute**           | **Requirement**                                                                                                                    |
|---------|-------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| NFR-001 | Security                | Authentication, authorization, validation, hashed passwords, secrets only in environment variables, never committed.               |
| NFR-002 | Integrity               | Relational constraints and validated domain rules.                                                                                 |
| NFR-003 | Atomicity & concurrency | Critical multi-record operations commit fully or roll back; stock and receipt operations remain correct under concurrent requests. |
| NFR-004 | Auditability            | Stock, approval and AI actions traceable to actor, time and reference.                                                             |
| NFR-005 | Maintainability         | Module boundaries; routes/controllers/services/repositories separation; AI provider behind an interface.                           |
| NFR-006 | Performance             | Indexes and pagination; proposed demo target: typical list API responses under 1 s on seed data (to be measured, not guaranteed).  |
| NFR-007 | Reliability             | Failures must not leave partial business state.                                                                                    |
| NFR-008 | Usability               | Consistent forms, tables, feedback and responsive layout.                                                                          |
| NFR-011 | Observability           | Structured logs, health endpoints for API and AI service.                                                                          |
| NFR-012 | Privacy                 | No real personal or company data sent to external LLMs; role-restricted data.                                                      |
| NFR-013 | AI transparency         | Every AI output shows its inputs, model version and whether the explanation came from an LLM.                                      |
| NFR-014 | Graceful degradation    | LLM or AI-service outage must not break ERP functions; suggestions without explanations remain usable.                             |
| NFR-015 | Cost                    | Operates at zero cost on free tiers; LLM calls cached and rate-limited to stay within free quotas.                                 |
| NFR-016 | Reproducibility         | Seed data generation and model training are deterministic given a fixed random seed.                                               |

# 11. Synthetic Demo Data Requirements

| **ID**   | **Requirement**                                                                                                                                                                               |
|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SEED-001 | 1 company, 1 factory, 2 warehouses, 3 categories, 15–20 auto-part products, 4–5 suppliers with different prices, lead times, MOQs and preferred flags.                                        |
| SEED-002 | 90 days of daily stock issues per product generated with Poisson noise, weekday effect (lower on Friday/Saturday), trends for some products and stable demand for others.                     |
| SEED-003 | Historical receipts simulated when stock falls low, so the ledger is realistic.                                                                                                               |
| SEED-004 | 5–10 injected anomalies with a ground-truth label stored separately for evaluation.                                                                                                           |
| SEED-005 | Ledger written in chronological order with correct balanceAfter and explicit back-dated createdAt; final Inventory balances must equal the last ledger balance (reconciliation check script). |
| SEED-006 | Fixed random seed; re-running produces identical data.                                                                                                                                        |
| SEED-007 | Demo scenarios: 3–4 products near reorder point, 1 trending product running out fast, 1 over-stocked product, 2–3 visible anomalies.                                                          |
| SEED-008 | All demo data is labelled synthetic in the UI footer or about page.                                                                                                                           |

# 12. Verification and Acceptance

- Unit tests: replenishment formula, supplier selection, safety stock,
  feature building, rule-based anomaly checks.

- Integration tests: stock operations, goods receipt, suggestion
  approval (single requisition on double approve).

- Concurrency tests: parallel issues cannot oversell; parallel goods
  receipts cannot exceed ordered quantity.

- API tests: valid, invalid, duplicate, unauthorized (401/403) and
  boundary requests.

- ML evaluation: holdout MAE for baseline and ML model; detection of
  injected anomalies and false positives, reported in AiModelRun and on
  the model page.

- End-to-end: AI-assisted procure-to-stock workflow (PRD 9.1) on the
  deployed environment.

- A requirement is complete only when its acceptance criteria and test
  evidence pass, not merely when an endpoint exists.

# 13. Known Defects in Current Codebase (Code Review, 2 Nov 2026)

Found by static review of the uploaded project archive; the code was not
executed. Each item must be verified and resolved in Phase 0 of the
Build Plan.

**Defect register**

| **ID** | **Defect**                                                                                                              | **Location**                                        | **Required fix**                                                     |
|--------|-------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|----------------------------------------------------------------------|
| D-01   | Client is a template; calls a non-existent /api/dashboard endpoint.                                                     | client/src/App.tsx                                  | Build MVP UI (Phase 6).                                              |
| D-02   | Read-then-write stock updates allow lost updates / overselling under concurrency.                                       | inventory.service.js; stock-transfer; goods receipt | Atomic conditional updates or row locks; concurrency tests.          |
| D-03   | Goods receipt checks remaining PO quantity outside the transaction.                                                     | procurement.service.js (createGoodsReceipt)         | Re-read and validate inside the transaction with conditional update. |
| D-04   | Sales order confirmation does not reserve stock; no warehouse on sales order.                                           | sales-order.service.js; schema                      | Deferred to Sales release (Later).                                   |
| D-05   | HTTP status derived from error message text; error middleware not registered.                                           | controllers; src/index.js                           | Typed AppError classes + central error middleware.                   |
| D-06   | Money calculated with JavaScript floating point.                                                                        | procurement and sales services                      | Use Prisma Decimal / decimal library for arithmetic.                 |
| D-07   | Validation inconsistent (Zod in some modules, manual elsewhere); no pagination.                                         | services/validators                                 | Zod for all write endpoints; paginated lists.                        |
| D-08   | No authentication, no automated tests, empty README, no git commits, empty duplicate migration, stray root src/ folder. | repository                                          | Phases 0, 4 and 7.                                                   |

# 14. Deployment and Operations

- Separate development (localhost) and demo (free cloud) configuration
  via environment variables.

- Secrets (DATABASE_URL, JWT_SECRET, LLM keys, AI service secret) only
  in environment settings; .env never committed.

- Database migrations reviewed and applied through prisma migrate
  deploy.

- Health checks for API and AI service; logs available in hosting
  dashboards.

- Free-tier limits (requests, cold starts, storage) verified before the
  demo; fallback LLM configured.

# 15. Open Items Requiring Approval

- AI service hosting choice (Vercel Python vs Render) after bundle-size
  test.

- Service level z-value and review period defaults for replenishment.

- Final role/permission matrix beyond the four MVP roles.

- Tax, currency, rounding and invoice numbering rules (post-MVP).
  Decision 2 Nov 2026: money inputs with more than two decimals are
  rounded half-up for the MVP; the wider tax and rounding policy still
  needs finance approval.

- Concurrency isolation strategy for sales and payments (post-MVP).

- Production performance, availability, recovery and retention targets.

# Approval

**Approval record**

| **Role**        | **Name**                         | **Signature / Date**             |
|-----------------|----------------------------------|----------------------------------|
| Business Owner  | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Technical Lead  | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Project Manager | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
