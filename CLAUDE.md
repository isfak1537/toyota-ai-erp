# Toyota AI ERP — Claude Code Guide

Personal project: an AI-powered ERP for a manufacturing (auto-parts) context.
Current goal: **MVP demo release** = Inventory & Procurement module + AI Core.

Source of truth (read before planning any task):
- `docs/Toyota_AI_ERP_PRD_v2.0.md` — what and why
- `docs/Toyota_AI_ERP_SRS_v2.0.md` — requirements (FR-, AI-, UI-, AUTH-, SEED-, NFR- IDs; defect register D-01..D-08)
- `docs/Toyota_AI_ERP_BUILD_ORDER_PLAN_v2.0.md` — phases P0–P7, gates, current phase

Always reference requirement IDs in plans, commits and PR descriptions.

## Repository layout

```
client/        React 19 + TypeScript + Vite (MVP UI to be built in P6)
server/        Node.js + Express 5 (CommonJS) + Prisma 7 + PostgreSQL
  prisma/      schema.prisma, migrations/, seed
  src/
    routes/ → controllers/ → services/ → repositories/
    validators/   Zod schemas
    middlewares/  validate, error
    modules/ai/   (new) replenishment, suggestions, llm.provider, ai.client
  prisma/seed/  synthetic data generator (deterministic), writer, CLI, anomaly-labels.json
  scripts/      reconcile.js
ai-service/    Python FastAPI (P2/P3): forecasting + anomaly models, read-only DB role, shared-secret API
docs/          PRD, SRS, Build Plan (Markdown)
```

## Commands

```
# server
cd server && npm install
npm run dev                      # nodemon src/index.js (port 5001)
npm test                         # unit + integration (needs TEST_DATABASE_URL, a *_test database)
npm run test:unit                # no database
npm run test:integration         # runs migrate deploy on the test DB, truncates between tests
npm exec prisma -- validate
npm exec prisma -- migrate dev --name <name>   # only after showing me the schema diff
npm exec prisma -- generate
npm run seed:synthetic           # synthetic demo data: DRY RUN by default
                                 #   -- --apply writes (refuses if seed rows exist), -- --apply --replace
                                 #   deletes exactly the SYN- rows first; --seed N, --end-date D
npm run reconcile                # inventory = last ledger balance + chain/document checks
                                 #   -- --scope seed|all, --strict

# client
cd client && npm install && npm run dev   # port 5173

# ai-service (P2/P3)  -- create the venv with an EXPLICIT python >= 3.11 (python.org or pyenv build, see below)
cd ai-service && /path/to/python3.13 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000    # needs ai-service/.env (AI_DB_URL, AI_SERVICE_SECRET)
.venv/bin/pytest                                       # unit + API tests; -m db (real read-only role), -m slow (notebooks)
.venv/bin/python scripts/build_notebooks.py            # executes notebooks/01_forecast_eval, 02_anomaly_eval
.venv/bin/python scripts/build_report.py               # regenerates ai-service/REPORT.md
cd server && npm run seed:export-fixtures              # regenerates ai-service/tests/fixtures (a test fails on drift)
```

Always run Prisma from `server/` using the project's local binary (`npm exec prisma -- <cmd>` or
`./node_modules/.bin/prisma <cmd>`), never a bare `npx` that may download another version.

Keep `npm test` passing.

## Architecture rules

- Keep the layering: routes → controllers → services → repositories. Controllers stay thin.
- Validate every write request with Zod.
- Throw typed `AppError` subclasses; never decide HTTP status from error message text. The central error middleware maps errors to status codes.
- Express 5 forwards thrown errors and rejected promises from async handlers to the error middleware. Controllers are plain `async` functions with no `try/catch` and no `asyncHandler`; just throw an `AppError` subclass.
- Status mapping: 400 malformed input or static rule (`ValidationError`); 404 missing record (`NotFoundError`); 409 duplicate or state conflict such as insufficient stock, wrong workflow status, inactive entity (`ConflictError`).
- Response envelope: `{ success, data, message, errors }`. List endpoints are paginated.
- Money: Prisma `Decimal` and decimal arithmetic, never JavaScript float math.
- Stock changes: only through inventory service operations, inside `prisma.$transaction`, using **atomic conditional updates** (e.g. `updateMany` with `where` on available quantity, then check `count`) or row locks. Never read-then-write quantities in JS.
- Every stock change writes an `InventoryTransaction` with a correct `balanceAfter` in the same transaction.

## AI rules (non-negotiable)

- AI never writes business records. The Python service uses a **read-only** DB role.
- Only `POST /api/v1/ai/suggestions/:id/approve` (by an authorized human) creates a DRAFT requisition, atomically and idempotently.
- Numbers come from code and models; the LLM only writes explanations and answers using supplied facts or read-only tools.
- LLM failure must never break a feature: return the result with `explanation: null`.
- LLM provider is chosen via env (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, fallback vars). Groq primary, Gemini fallback, Ollama for local dev.
- Log suggestion runs, LLM calls and human decisions to `AiAuditLog`.
- Report model metrics honestly, including when the ML model does not beat the baseline.

## Safety rules for Claude Code

- Never read, print, edit or commit `.env` or any secret. Use `.env.example` for documentation.
- Never run `prisma migrate reset`, drop tables, delete data or force-push without asking first.
- Show the schema diff and migration SQL before applying a migration.
- Plan before coding for any non-trivial task; wait for approval.
- Work in small steps: one service, endpoint or page per task, with tests.
- If a requirement is unclear or conflicts with the code, stop and ask; do not guess.
- Do not add dependencies without saying why.

## Testing

- Unit tests for services and formulas; integration tests against a separate test database.
- Concurrency tests for stock issue, reservation and goods receipt.
- API tests include valid, invalid, duplicate, 401/403 and boundary cases.
- Python: pytest for features, baseline, metrics and anomaly rules.

## Git

- One branch per phase (`phase-0-fixes`, `phase-2-forecast`, ...).
- Small commits: `P0: fix D-02 atomic stock issue (FR-007)`.

## Current status

- P0 is merged and tagged `m1-stable-core`; P1 (synthetic data and reconcile) is merged and tagged `m2-seed`.
- P2 + P3 (AI service) are built on branch `phase-2-ai-service` and wait for the owner's confirmation:
  `GET /health`, `POST /forecast`, `POST /anomalies/score`, `POST /train` behind `X-AI-Service-Secret`; global
  gradient-boosting forecast vs a moving-average baseline (14-day holdout, nested selection estimate, sigma from
  residuals); rules R1-R5 + an Isolation Forest risk score with a weekly review queue (top 10 per local week, top contributing features), evaluated against `anomaly-labels.json`; model registry
  with deterministic versions; notebooks and `ai-service/REPORT.md`. The ERP API does not call it yet (P4).
- Next: P4 (ERP AI module: replenishment, suggestions, approval, minimal auth). Update this section when a phase gate passes.

### Pending verification

- None.

### Known gaps (not blocking)

- No authentication or authorization yet: every endpoint is public until P4.
- The ledger cannot reconcile reserved quantity: RESERVATION/RELEASE rows carry quantity 0 and
  the amount only appears in the free-text reason. Add a `reservedDelta`/`reservedAfter` column in
  P4, then extend `scripts/reconcile.js` to check it.
- The seed bulk-inserts back-dated stock history directly, bypassing the inventory service (the
  service cannot back-date). It is the one documented exception to "stock changes only through the
  service"; the CHECK constraints and `npm run reconcile` verify the result.
- SEED-008: label the demo data as synthetic in the UI footer or about page (P6 checklist; the
  data itself is marked by the company name "Toyota AI ERP (Synthetic Demo)" and SYN- prefixes).
- Anomaly time convention: events are stored in UTC, business hours are 08:00-17:00 Asia/Dhaka
  (02:00-11:00 UTC), weekend Fri/Sat. The daily series (AI-001) and the anomaly model (P3) must
  use the same convention.
- The other modules (product, category, company, factory, warehouse, supplier, supplier-product,
  customer, sales-order) still use the legacy error bridge or their own try/catch; migrate them
  to `AppError` and Zod when they are next touched. Product lists use `limit`, the new lists use
  `pageSize` (both are accepted on the new lists).
- Low-stock compares two tables' columns in JS, so it loads all inventory rows before paging;
  move to SQL when data grows.
- Invoice quantity caps against a PO are per invoice, not cumulative, and goods receipt does not
  re-check that the product is still active.
- Money inputs with more than 2 decimals are rounded half-up (accepted for the MVP, SRS section
  15); the wider tax and rounding policy still needs finance approval.
- Interactive transactions use Prisma's defaults (maxWait 2 s, timeout 5 s) and the pg pool its
  default of 10 connections; P2028 never occurred in the parallel tests, but revisit both at
  deployment (P7).
- Prisma's query engine runs nested `include` queries concurrently on one transaction connection;
  pg logs a deprecation warning that becomes an error in pg@9. Track upstream before upgrading pg.
- AI service results to decide on (see `ai-service/REPORT.md`): per-series model selection as written in AI-003 is
  optimistic (nested estimate 1.414 vs 1.317 for always using the ML model); after the second anomaly pass the
  rules catch 7 of 8 and the weekly queue 6 of 8 (together 8 of 8), but flags rose from 33 to 147 and combined precision fell
  from 0.18 to 0.05; most of the recall gain comes from not scoring document-linked receipts, which blinds the model to a wrong
  receipt that has a document. Rule R2 fires on ordinary tail events; a days-of-demand criterion is an owner decision.
  Thresholds were deliberately not tuned on 8 labels.
- The AI service stores models as joblib pickles under `ai-service/models/` (gitignored): load only artefacts it trained
  itself. `/train` is synchronous (seconds on this data) and one run at a time.
- Python environment: the service was built and tested on python.org 3.13.5; that is fine for now and the hosting runtime is decided in P7. Homebrew's Python 3.12.16 and 3.14.7 have an
  empty `platform.mac_ver()` on macOS 26 and break pip inside venvs; use a python.org or pyenv build.
- The AI service reads the whole ledger series it is asked about; fine for the MVP, add a date window when ledgers grow.
