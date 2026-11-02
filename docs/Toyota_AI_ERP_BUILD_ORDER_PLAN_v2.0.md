**TOYOTA AI ERP**

BUILD ORDER & IMPLEMENTATION PLAN

*MVP delivery phases, Claude Code workflow, release gates and roadmap*

| **Item**   | **Detail**                                                                           |
|------------|--------------------------------------------------------------------------------------|
| Project    | AI-Powered ERP Platform for Manufacturing                                            |
| Version    | 2.0 — Final MVP Baseline                                                             |
| Date       | 2 November 2026                                                                      |
| Supersedes | Version 1.0 — Consolidated Draft (2 November 2026)                                   |
| Status     | Final working baseline for the MVP demo release; formal stakeholder approval pending |

**CONFIDENTIAL — PROJECT WORKING DOCUMENT**

# 1. Executive Status

A static code review of the uploaded project archive (2 November 2026)
confirms that the backend for B1–B4 exists and B5 is partially
implemented (customer management and basic sales orders). The code was
read but not executed, so runtime behavior must be re-verified. The
review also found defects that must be fixed before building on top (SRS
section 13).

| **Area**        | **Status from code review**                                                                                                  |
|-----------------|------------------------------------------------------------------------------------------------------------------------------|
| Backend B1–B4   | Implemented: organization, product/supplier, inventory ledger, procurement. Concurrency and error-handling defects present.  |
| Backend B5      | Partial: customer CRUD; sales order create/list/get/confirm/cancel. No warehouse, reservation, delivery, invoice or payment. |
| Frontend        | Not started (Vite template only).                                                                                            |
| Auth, tests, CI | None.                                                                                                                        |
| Repository      | No git commits; README empty; one empty duplicate migration; stray root src/ folder.                                         |

# 2. Delivery Strategy

Instead of building all 14 batches, the project delivers an **MVP demo
release**: the Inventory & Procurement module, completed to
production-like quality, plus the AI Core. This reuses the strongest
existing work, shows one end-to-end workflow with AI, and proves the
architecture for later modules. Sales (B5) is paused and resumes after
the MVP.

# 3. Full Roadmap (Revised)

**Roadmap**

| **Batch** | **Workstream**                                        | **Status**                                            | **Release**                  |
|-----------|-------------------------------------------------------|-------------------------------------------------------|------------------------------|
| B1        | Organization Management                               | Implemented                                           | MVP (verify)                 |
| B2        | Product & Supplier                                    | Implemented                                           | MVP (verify)                 |
| B3        | Inventory & Stock Ledger                              | Implemented; defects D-02                             | MVP (harden)                 |
| B4        | Procurement                                           | Implemented; defects D-03, D-06                       | MVP (harden)                 |
| B5        | Sales & CRM                                           | Partial; paused                                       | After MVP                    |
| B6–B11    | Manufacturing, MRP, Maintenance, Quality, HR, Finance | Planned                                               | After MVP                    |
| B12       | Authentication & RBAC                                 | Minimal version pulled into MVP                       | MVP (minimal) + Later (full) |
| B13       | AI, IoT & Analytics                                   | Forecasting, replenishment, anomaly, assistant in MVP | MVP (core) + Later (rest)    |
| B14       | Production Readiness                                  | Free deployment, README, tests in MVP                 | MVP (partial) + Later        |

# 4. MVP Phases

**MVP phases**

| **Phase** | **Deliverable**                                                                                  | **Acceptance gate**                                         | **Est. days\*** |
|-----------|--------------------------------------------------------------------------------------------------|-------------------------------------------------------------|-----------------|
| P0        | Repo hygiene + defect fixes D-02, D-03, D-05, D-06 (procurement), D-07 (MVP modules)             | Concurrency tests pass; central errors; git history started | 2–3             |
| P1        | Synthetic seed generator + reconciliation check                                                  | Seed reproducible; inventory = last ledger balance          | 2               |
| P2        | Python AI service: forecasting (baseline + ML) + evaluation notebook                             | MAE reported for both; /forecast works                      | 3–4             |
| P3        | Anomaly model (Isolation Forest + rules)                                                         | Injected anomalies evaluated; /anomalies/score works        | 2               |
| P4        | Node AI module: schema, auth (minimal), replenishment, suggestions, approve → requisition, audit | Double approve creates one requisition; 401/403 correct     | 3–4             |
| P5        | LLM provider (Groq/Gemini/Ollama), explanations, cache, assistant                                | Works with LLM off; assistant read-only                     | 2               |
| P6        | React UI: login, dashboard, forecast, suggestions, anomalies, procurement, ledger, assistant     | Full demo flow via UI                                       | 4–5             |
| P7        | Deployment, README, demo script, final review                                                    | Public URL runs PRD 9.1 end-to-end                          | 2               |

\*Rough estimates for one developer using Claude Code; actual time
depends on available hours.

# 5. Phase Details

## P0 — Foundation and defect fixes

- Initialize git, add .gitignore (.env, node_modules, .DS_Store,
  generated Prisma), first commit of current state.

- Remove stray root src/ and the empty duplicate migration only after
  confirming with prisma migrate status.

- Create AppError classes (ValidationError, NotFoundError,
  ConflictError, ForbiddenError) and register central error middleware.

- Rewrite issue/reserve/adjust/transfer with atomic conditional updates;
  move goods-receipt validation inside the transaction.

- Decimal arithmetic in procurement totals; Zod validators for inventory
  and procurement writes; pagination for list endpoints.

- Add test setup (Vitest or Jest + Supertest) with a separate test
  database; concurrency tests for issue and goods receipt.

## P1 — Synthetic data

- prisma/seed/generate.js with seeded random generator; master data,
  90-day history, receipts, injected anomalies (labels saved to a JSON
  file).

- scripts/reconcile.js verifies inventory balances against ledger
  (implemented as server/scripts/reconcile.js, `npm run reconcile`; the
  generator is `npm run seed:synthetic`, dry run by default).

## P2 — Forecasting

- ai-service/ FastAPI project; read-only DB role; features.py builds
  daily series.

- Baseline moving average; ML regressor (e.g.
  GradientBoosting/RandomForest) with day-of-week, lags, rolling means.

- 14-day holdout evaluation; save model with joblib and metrics;
  notebook with charts for the demo.

## P3 — Anomaly detection

- Transaction features; Isolation Forest; rule layer; reasons;
  evaluation against injected labels.

## P4 — ERP AI module and minimal auth

- Prisma migration: User, AiSuggestion, AnomalyFlag, AiModelRun,
  AiAuditLog, actor fields.

- JWT auth middleware and requireRole(); seed four demo users.

- replenishment.service (formula, supplier selection, onOrder),
  suggestions endpoints, approval transaction, audit log.

## P5 — LLM layer

- llm.provider with OpenAI-compatible client; Groq primary, Gemini
  fallback, Ollama local; timeouts; caching in DB.

- Explanation prompts that only use supplied facts; assistant with
  read-only tools.

## P6 — Web interface

- React Router, API client with token, layout and role-aware navigation,
  chart library for forecasts.

- Pages per SRS section 6; loading/empty/error states.

- Footer or about page labels the demo data as synthetic (SEED-008).

## P7 — Release

- Neon database, Vercel deployments, AI service hosting decision,
  environment variables, migrate deploy, seed.

- README (setup, architecture, AI design, limitations), demo script,
  final code review.

# 6. Working With Claude Code

## 6.1 One-time setup

1.  Put the three v2.0 documents in docs/ (export to Markdown with
    pandoc so Claude Code can read them easily).

2.  Put the provided CLAUDE.md at the repository root. Claude Code reads
    it automatically every session.

3.  Initialize git and commit before any change, so every step can be
    reviewed and reverted.

4.  Start each phase on its own branch, e.g. phase-0-fixes,
    phase-2-forecast.

## 6.2 Loop for every task

1.  **Plan first:** ask Claude Code to read the relevant docs and code
    and propose a plan (use plan mode). Do not let it write code until
    you agree with the plan.

2.  **Small steps:** one task at a time (one service, one endpoint, one
    page).

3.  **Tests with the change:** ask for tests in the same task and have
    Claude Code run them.

4.  **Review the diff yourself:** read every change; ask "why" for
    anything unclear. You must be able to explain it to your manager.

5.  **Commit:** one commit per completed task with a clear message.

6.  **Update docs:** tick the phase checklist in docs/ when a gate
    passes.

## 6.3 Rules to give Claude Code

- Never edit .env or commit secrets; never run prisma migrate reset or
  delete data without asking.

- Follow the existing layering (routes → controllers → services →
  repositories).

- No AI component may write business records; approvals go through ERP
  services.

- Stop and ask when a requirement in the SRS is unclear instead of
  guessing.

## 6.4 Starter prompts per phase

### P0

Read CLAUDE.md, docs/SRS (section 7 and 13) and
server/src/services/inventory.service.js.

Plan only: how will you fix defect D-02 (concurrency) for issue,
reserve, adjust

and transfer using atomic conditional updates inside
prisma.\$transaction?

List files to change and the tests you will add. Do not write code yet.

### P1

Implement SEED-001..SEED-008 from docs/SRS section 11 as
server/prisma/seed/generate.js

with a fixed random seed, plus scripts/reconcile.js. Show me the plan
first.

### P2

Create ai-service/ (FastAPI) per docs/SRS AI-001..AI-003. Start with
features.py and

the moving-average baseline with a holdout MAE test. Explain each file
briefly.

### P4

Add the Prisma models from docs/SRS section 8 in one migration. Show the
schema diff

and the migration SQL before applying it.

### P5

Implement server/src/modules/ai/llm.provider.js per AI-009 and AI-012:
OpenAI-compatible

client, Groq primary, Gemini fallback, 10s timeout, returns null on
failure.

### P6

Plan the React app structure (routes, API client, auth context, pages
from SRS section 6).

Then build the Login page and Inventory dashboard first.

## 6.5 Review before each gate

At the end of P0, P4 and P7, ask Claude Code for a critical review of
the changed code (security, edge cases, concurrency, tests). Fix
findings before moving on.

# 7. Definition of Done (per phase)

- Approved requirements for the phase are implemented and acceptance
  gate passes.

- Migrations apply cleanly; schema validated.

- Server-side validation and authorization enforced.

- Positive, negative, duplicate, boundary and (where relevant)
  concurrency tests pass.

- You can explain every changed file.

- Docs updated; changes committed.

# 8. Demo Script (10 minutes)

1.  Problem and architecture in one slide (ERP + AI Core,
    human-in-the-loop).

2.  Login as Procurement Officer; dashboard shows low stock and days of
    cover.

3.  Open the trending product: history, baseline and ML forecast; MAE
    comparison.

4.  Run replenishment; open a suggestion; show inputs and AI
    explanation.

5.  Approve → draft requisition → submit/approve → PO → goods receipt;
    ledger and stock update.

6.  Show the over-stocked product where AI suggests no order.

7.  Login as Warehouse Manager; review an anomaly flag with its reason.

8.  Ask the AI assistant a question.

9.  Close: limitations (synthetic data, free tiers) and roadmap — how
    Sales, Manufacturing and Finance plug into the same AI Core.

# 9. Risks and Mitigations

| **Risk**                                          | **Impact**                             | **Mitigation**                                               |
|---------------------------------------------------|----------------------------------------|--------------------------------------------------------------|
| Free LLM quota or outage during demo              | No explanations                        | Fallback provider; cached explanations; graceful degradation |
| AI service too large for Vercel                   | Deployment delay                       | Test bundle early; Render free tier as alternative           |
| Hosting cold start                                | Slow first request                     | Warm up URLs before the demo                                 |
| Synthetic data flatters the model                 | Over-claiming                          | State clearly; show baseline comparison                      |
| Stock concurrency                                 | Overselling                            | Atomic updates + concurrency tests (P0)                      |
| Scope creep                                       | MVP not finished                       | Change only via this plan; Sales waits until after MVP       |
| Accepting AI-generated code without understanding | Cannot explain to manager; hidden bugs | Review every diff; tests; ask Claude Code to explain         |

# 10. After the MVP

- Resume B5 Sales: warehouse assignment, reservation on confirmation,
  delivery, invoice, payment, receivables; add demand forecasting from
  sales orders to the AI Core.

- Full RBAC and audit (B12); CI pipeline; then Manufacturing/MRP using
  the same forecast service.

# Approval

**Approval record**

| **Role**        | **Name**                         | **Signature / Date**             |
|-----------------|----------------------------------|----------------------------------|
| Project Manager | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Technical Lead  | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Developer       | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
