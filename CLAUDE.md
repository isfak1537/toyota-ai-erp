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
ai-service/    (new, P2) Python FastAPI: forecasting + anomaly models
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
npm run db:seed

# client
cd client && npm install && npm run dev   # port 5173

# ai-service (from P2)
cd ai-service && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
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

- P0 in progress (branch `phase-0-fixes`). Done: repo hygiene, D-05 (typed errors, central error
  middleware, app/index split), test database harness (1.3), D-02 (atomic stock changes for
  receive, issue, adjust, reserve, release and transfer, with concurrency tests and CHECK
  constraints). Open for the P0 gate: D-03, D-06, D-07. Known defects: see SRS section 13.
- Update this section when a phase gate passes.

### Pending verification

- Goods receipt still updates inventory with read-then-write (lost updates possible) until D-03.
- The `Inventory` CHECK-constraint migration is applied to the test database by the harness but
  not yet to the dev database: run `npm exec prisma -- migrate deploy` in `server/`.
- Prisma's query engine runs nested `include` queries concurrently on one transaction connection;
  pg logs a deprecation warning that becomes an error in pg@9. Track upstream before upgrading pg.
