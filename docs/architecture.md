# Architecture

Three programs and a database. Requirement IDs (FR-, AI-, UI-, AUTH-, NFR-) refer to
`docs/Toyota_AI_ERP_SRS_v2.0.md`.

```
 browser
   │  React single-page app, JWT in sessionStorage
   ▼
 client/        Vite + React 19 + TypeScript
   │  /api/v1 (JSON, { success, data, message, errors })
   ▼
 server/        Express 5 (CommonJS), Prisma 7, PostgreSQL
   │   routes → controllers → services → repositories
   │
   ├──► ai-service/   FastAPI (Python): forecasting, anomaly scoring, training
   │        │           shared secret header X-AI-Service-Secret; read-only database role
   │        └──► PostgreSQL (the same database, SELECT on three tables only)
   │
   └──► LLM provider  Groq → Gemini (fallback) → Ollama (local): explanations and the assistant
```

## Project tree

```
client/
  src/
    api/          HTTP client (token, 401/503 events), types, read queries
    auth/         login state, route guards (session, role)
    components/   layout, shared UI (tables, tabs, badges, states), assistant panel, error boundary
    lib/          formatting (business time), permissions, navigation
    pages/        Dashboard, Forecast, Suggestions, Anomalies, Procurement, NewRequisition, Ledger, Models, AuditLog, Login
    styles/       design tokens (colours, spacing, type), base and component CSS
  e2e/            Playwright against the real stack: smoke, accessibility, screenshots
server/
  api/index.js    Vercel entry point (exports the Express app)
  prisma/         schema.prisma, migrations/, seed/ (deterministic synthetic data, labels)
  scripts/        reconcile, seed:users, demo prepare/undo, test-loop, fixture export
  src/
    routes/ controllers/ services/ repositories/ validators/   the ERP core (inventory, procurement, master data)
    middlewares/  auth (JWT, roles), validation (Zod), central error handling, login limiter
    modules/ai/   ai.client, replenishment (formulas), suggestions, anomalies, models, cover (days of cover)
      llm/        providers (OpenAI-compatible), rate limiter, explanations
      assistant/  read-only tools and the tool loop
    modules/demo/ demo staging (drain stock, put it back)
  tests/          unit, integration (separate *_test database), live (optional real Groq calls)
ai-service/
  app/
    data/         ledger sources (CSV fixtures, Postgres read-only), daily demand series
    forecasting/  baseline, features, model, evaluation, service, training
    anomaly/      features, rules R1-R5, Isolation Forest, evaluation, service, training
    registry.py   versioned model store with an atomic "active" switch
  scripts/        build_notebooks, build_report, measure_bundle
  sql/            create_ai_readonly_role.sql
  notebooks/      executed evaluation notebooks; REPORT.md is generated from the same code
docs/             PRD, SRS, build plan, this file, deployment, demo script, release checklist, screenshots
```

## The ERP core (FR-001..FR-0xx)

* **Layering.** Routes → controllers → services → repositories. Controllers are thin; services hold the rules; only
  repositories and services talk to Prisma.
* **Errors.** Typed `AppError` subclasses (400 / 401 / 403 / 404 / 409 / 503). One error middleware maps them to status
  codes and the `{ success, data, message, errors }` envelope. No status is derived from message text.
* **Stock integrity.** Every stock change goes through the inventory service inside one transaction, using an atomic
  conditional `UPDATE` (the quantity check is part of the statement, never read-then-write in JavaScript). It writes an
  `InventoryTransaction` with `balanceAfter` and `reservedAfter`, so the ledger can always be reconciled
  (`npm run reconcile`). Database CHECK constraints are a second line of defence. Concurrency tests cover issue,
  receipt, reservation, transfer and the purchase-order cap.
* **Money** uses decimal arithmetic, never floats.
* **Procurement** states (requisition → purchase order → goods receipt) are conditional updates; the destination
  warehouse flows from requisition to order to receipt, and receiving elsewhere is an audited, role-restricted override.
* **Auth.** Bcrypt hashes, JWT (HS256) checked against the database on every request (a deactivated user is out at
  once), four roles, a role matrix in `middlewares/roles.js`, a login-attempt limiter. Every write is attributed to a user.

## The AI core

### Forecast (AI-001..003)

Daily zero-filled demand per product and warehouse from ISSUE rows (business time UTC+6). Two methods: a moving average
(window 7 or 14, chosen on training days only) and one global gradient-boosting model with lag and calendar features
(Poisson loss, direct multi-horizon). Policy: the model for a series with at least 28 days of history, the baseline
otherwise. Uncertainty σ is the holdout RMSE, floored at the Poisson spread. A model version is a hash of data, config and
library versions, never the clock, so training the same data gives the same version.

### Replenishment (AI-004..007), computed in the ERP

`SS = z·σ·√L`, `ROP = d·L + SS`; if available ≤ ROP, order `max(MOQ, ceil(d·(L + review) + SS − available − onOrder))`,
unless open orders already cover the need. *Available* is on hand minus reserved. *onOrder* is the open purchase-order
quantity addressed to the warehouse plus a demand-share of orders without a destination, floored. Supplier: the preferred
active one, else the cheapest. Every input is stored on the suggestion, so any number can be reproduced.

### Anomalies (AI-008)

Five transparent rules (R1 large negative adjustment, R2 quantity far above normal, R3 outside business hours,
R4 large manual receipt, R5 duplicate movement) and an Isolation Forest whose score becomes a risk percentile.
Receipts that carry a purchase document are scored but never queued. The top ten per local week form the review queue;
each queued row carries the features that raised its score, worded as sentences. Rule hits and the queue are different
lists with different meanings.

### Language model (AI-009, AI-010, AI-012)

OpenAI-compatible providers behind one interface, chosen by environment variables. Explanations are generated from the
computed facts and cached on the row. Background explanations use at most half of the per-minute budget so the assistant
always has headroom; the daily cap is counted from the audit log. The assistant has a fixed set of **read-only** tools
(low stock, stock, forecast, days of cover, suggestions, anomalies, models); tests prove none can write, including with
hostile prompts and a database proxy that throws on any write.

### Demo staging rows

`demo:prepare` drains stock through the normal inventory service with `referenceType DEMO_PREPARE` (and `DEMO_PREPARE_UNDO`
when put back). The AI service drops those rows where it reads the ledger, so staging is never demand and never an anomaly.

## Data flow: from a forecast to a receipt

```
ERP  POST /ai/replenishment/run  ─► reads stock, suppliers, open POs from PostgreSQL
                                 ─► AI service /forecast  (sigma, daily mean, model version)
                                 ─► computes ROP and quantity ─► stores PENDING suggestions + audit row
                                 ─► asks the LLM for explanations (best effort; null on failure)
person  approves ─► POST /ai/suggestions/:id/approve
                    one transaction: lock the suggestion row, create a DRAFT requisition (destination = suggestion's
                    warehouse), link it, mark APPROVED, audit.  Twice or in parallel → the same requisition.
person  submits, approves, creates the purchase order (inherits the destination), approves it
person  receives goods ─► goods receipt (defaults to the destination) ─► receipt ledger row, stock and order updated
```

## Failure behaviour (NFR-007, NFR-014)

| Failure | What happens |
|---|---|
| AI service down or slow | AI routes answer 503 with a clear message; the UI shows a banner; inventory, procurement, ledger, approvals keep working. Days of cover shows a low-stock fallback. |
| LLM down, quota used, key missing | `explanation: null` ("unavailable"); the assistant answers "not available". Nothing else changes. |
| Two people approve the same suggestion | Row lock; the second call returns the same requisition (`idempotent: true`). |
| A request fails half way | Every multi-record action is one transaction; nothing partial is committed. |
| Models lost on a restart (hosts without a disk) | `AI_AUTOTRAIN` retrains on start; training is deterministic. |

## Time convention

Timestamps are stored in UTC. Business time is Asia/Dhaka (UTC+6): business hours 08:00-17:00 local (02:00-11:00 UTC),
weekend Friday/Saturday, local weeks run Sunday to Saturday. The demand series, the anomaly rules, the review-queue weeks
and the UI all use the same convention.

## Security model

* Secrets only in environment variables; `.env` is never committed; the example files hold names only.
* The AI service refuses to start without its shared secret, answers 401 before routing or parsing, and has no `/docs`.
  Only `/health` is public and it shows status and model versions, not the Python or library versions; those are on
  `GET /diagnostics`, which needs the secret.
* The AI database role has `SELECT` on columns of three tables, is read-only at role and session level, and has a statement timeout.
* Passwords are hashed; tokens expire; the stored role wins over the token's; login attempts are limited.
* The LLM never sees keys, passwords or personal data; prompts contain only computed facts and product names; audit rows
  store provider, model, purpose and outcome, never the prompt.
* Browser: tokens live in `sessionStorage`; the client sets a content security policy; the API sets `nosniff`, no framing,
  no caching.

## Testing

| Layer | Where | Notes |
|---|---|---|
| Unit | `server/tests/unit`, `ai-service/tests`, `client/src/**/*.test.*` | formulas, rules, parsing, components |
| Integration | `server/tests/integration` (own `*_test` database, guarded) | 650+ tests incl. concurrency and the 401/403 matrix over every route |
| API contract | `ai-service/tests/test_api_*` | valid, invalid, unauthenticated, boundary |
| Real stack | `client/e2e` | smoke per role, axe accessibility on every page, phone-width overflow |
| Mutation checks | during development | break the code on purpose and confirm the tests fail |

## Decisions worth knowing

* **One global forecast model**, not one per series: 14 noisy days per series are too little to select on (the nested estimate
  showed that selection hurt).
* **Labels are used only to evaluate**, never to train or to set a threshold.
* **Server computes the replenishment numbers**, not the AI service, so every figure is in code that is tested and
  stored with the suggestion.
* **No ORM access from the assistant's tools beyond reads**, enforced by a registry, a source scan and a throwing proxy.
