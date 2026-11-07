# Requirements status (SRS v2.0, PRD 12.1 and 12.2)

Verification pass of **2026-11-07** on branch `verify-mvp`, local machine only. Nothing here was checked on a deployed URL: the
system has not been deployed yet.

Status values:

* **Verified**: observed directly in this pass (a measurement, a screenshot, a run against the real stack).
* **Verified by test**: an automated test that passes in `npm test` (server), `npm test` (client) or `pytest` (ai-service) asserts it.
* **Not verified**: no test or observation in this pass covers it, or it covers only part of it (the part is named).
* **Out of scope**: the SRS marks it Later; not built for the MVP.

"Evidence" names the test file (under `server/tests/`, `client/src/` or `ai-service/tests/`), the screenshot (under
`docs/screenshots/verify/`) or the measurement. A test passing means the behaviour the test asserts holds, not that every sentence of
the requirement was checked; where a requirement has a part no test covers, the status says so.

## Results of this pass in one place

| Check | Result |
|---|---|
| Full suites at the end of the pass | server `npm test` 745 passed (57 suites); client 208 passed, lint and build clean; ai-service 388 passed (+1 slow notebook test, passed earlier in this pass) |
| Role matrix, nine actions, four roles and no token | all as the SRS matrix says (table below) |
| Procure-to-stock loop through the API, then reconcile | passes; reconcile `Result: OK (0 errors, 0 warnings)` on the test database |
| LLM key unset, and LLM rejecting every call | whole loop, explanation endpoint and assistant keep working; explanations are null / "Explanation unavailable" |
| Page sweep as admin (12 pages) | no console error, no page error, no failed request, no write request |
| Local latency of seven list endpoints | p95 18 ms or less (table below) |
| `npm run reconcile` on the dev database (read-only) | `Result: OK (0 errors, 2 warnings)`; both warnings explained below |

### Role matrix (HTTP status, test database; `verification-roles.test.js`)

An allowed role gets past authorization; the invented id or empty body then gives 400/404. 201 = the action ran. "-" = not applicable.

| Action | ADMIN | WAREHOUSE_MANAGER | PROCUREMENT_OFFICER | VIEWER | no token |
|---|---|---|---|---|---|
| run replenishment | 201 | 403 | 201 | 403 | 401 |
| approve suggestion | 404 | 403 | 404 | 403 | 401 |
| new requisition | 400 | 403 | 400 | 403 | 401 |
| approve requisition | 404 | 403 | 404 | 403 | 401 |
| create PO | 400 | 403 | 400 | 403 | 401 |
| receive goods | 400 | 400 | 400 | 403 | 401 |
| view anomalies | 200 | 200 | 200 | 200 | 401 |
| retrain models | 201 | 403 | 403 | 403 | 401 |
| view audit log | 200 | 403 | 403 | 403 | 401 |

On the dev server the four demo users each logged in with HTTP 200 and the expected role (ADMIN, WAREHOUSE_MANAGER,
PROCUREMENT_OFFICER, VIEWER); read-only, nothing written.

### Local latency (NFR-006)

**This is a local measurement**: one developer laptop, API and PostgreSQL on the same machine, no network, a warm connection, one
client, one sequential request at a time, 20 requests per endpoint as admin, first page (about 20 rows) of the dev database (27
stock rows, about 3,000 ledger rows, 102 purchase orders). It says nothing about the hosted setup (Vercel functions, Neon, cold
starts), which is not measured. The slowest single request overall was 346 ms (the first products call, a cold start).

| Endpoint | rows returned | p50 (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|
| GET /products?limit=20 | 20 | 4 | 10 | 346 |
| GET /inventory?pageSize=20 | 20 | 3 | 18 | 21 |
| GET /inventory/transactions?pageSize=20 (ledger) | 20 | 4 | 5 | 25 |
| GET /ai/suggestions?status=PENDING | 5 | 3 | 4 | 9 |
| GET /ai/anomalies?status=OPEN&kind=rule | 20 | 4 | 6 | 11 |
| GET /procurement/requisitions?pageSize=20 | 2 | 4 | 8 | 14 |
| GET /procurement/purchase-orders?pageSize=20 | 20 | 6 | 17 | 22 |

### AI quality (PRD 12.2), from `ai-service/REPORT.md`

Regenerating the report from the committed fixtures with `scripts/build_report.py` gave a byte-identical file (no `git diff`), and
the slow test `test_re_executing_the_notebooks_reproduces_the_committed_text_outputs` passes. All of it is **synthetic data** (seed
20261102, 24 series, holdout 2026-10-19 to 2026-11-01).

* **Forecast MAE on the 14-day holdout, units/day:** moving-average baseline **1.536**, ML model (the AI-003 policy) **1.317**, 14.3 %
  lower, better on 18 of 24 series. Without the five series whose last days the seed generator steers, the advantage is 7.9 % (1.276 vs 1.175).
  The old per-series "lower MAE" rule scores 1.294 but its nested honest estimate is 1.414, worse than the ML model alone.
* **Anomalies, 8 injected (`server/prisma/seed/anomaly-labels.json`, count 8):** rules R1-R5 find **7 of 8**, the weekly review queue
  (top 10 per week) finds **6 of 8**, together **8 of 8**. Cost: **147 flags, so 139 false flags**, combined precision **0.054**
  (8 / 147); before the second pass it was 33 flags and precision 0.182. The report states the thresholds were not tuned on 8 labels.
* The Models page of the dev database shows other figures (baseline 1.42, model 1.22, 26 series; 2,986 movements, 150 flagged)
  because the dev database holds two more series and some later movements than the committed fixture; those are a different
  training run, not a contradiction. Quote the report's numbers for the evaluation.

## PRD 12.1 MVP demo acceptance

| Bullet | Status | Evidence |
|---|---|---|
| Full AI-assisted procure-to-stock loop runs end to end **on the deployed URL** | **Not verified** | Not deployed. The same loop through the API against the test database passes: `integration/procure-to-stock-loop.test.js` (run replenishment as PROCUREMENT_OFFICER, approve, submit, approve requisition, create and approve PO, receive goods as WAREHOUSE_MANAGER, stock up by 80, RECEIPT ledger row with the right balance). The same loop through the browser UI was not run in this pass. |
| Every suggestion shows its inputs and an explanation; approving creates a linked draft requisition | Verified by test | `client/src/pages/Suggestions.test.tsx`, `integration/suggestion-decisions.test.js`, `integration/procure-to-stock-loop.test.js` (requisition linked by `requisitionId`, `sourceType AI_SUGGESTION`); `docs/screenshots/verify/suggestions.png`, `suggestions-review.png` |
| Stock balances reconcile with the ledger after the demo workflow | Verified by test | `procure-to-stock-loop.test.js` ends with reconcile `strict`: `Result: OK (0 errors, 0 warnings)`. Dev database (read-only): `Result: OK (0 errors, 2 warnings)`: product BRK-PAD-001 at MAIN-WH has stock 150 and no ledger rows (the early hand-entered development row), and 2 rows have ledger rows from before `reservedAfter` existed. Neither is a mismatch. |
| Seeded anomalies are visible in the anomaly list with reasons | Verified | `docs/screenshots/verify/anomalies-rules.png` and `anomalies-queue.png` (22 confirmed rule hits and 50 queue rows, each with its reasons); 8 of 8 injected found by rules and queue together (REPORT.md). |
| System keeps working without explanation text when the LLM API is unavailable | Verified by test | `procure-to-stock-loop.test.js` (key unset, and every LLM call failing), `integration/llm-explanations.test.js`, `integration/assistant.test.js` ("answer null"). Not run against the real Groq API with a deliberately bad key. |

## ERP core (SRS section 4)

| ID | Status | Evidence / what is missing | Date |
|---|---|---|---|
| FR-001 | Not verified | Only the role and 401/403 behaviour of the company, factory and warehouse routes is tested (`integration/route-access.test.js`); no test creates, updates or deactivates them. | 2026-11-07 |
| FR-002 | Not verified | Product routes appear in `route-access.test.js`, `replenishment.test.js` and `prisma-errors.test.js`; no test of product master-data maintenance as such. | 2026-11-07 |
| FR-003 | Not verified | Supplier routes tested only for roles (`route-access.test.js`). | 2026-11-07 |
| FR-004 | Not verified | Supplier-product routes tested only for roles; the AI-005 tests read supplier-product rows. | 2026-11-07 |
| FR-005 | Verified by test | `integration/stock-writes.test.js` (create inventory, duplicate 409), `inventory-constraints.test.js`, `review-fixes.test.js`; `docs/screenshots/verify/dashboard.png`. | 2026-11-07 |
| FR-006 | Verified by test | `stock-writes.test.js` (RECEIPT row with new balance), `concurrency-issue-receive.test.js`, `procure-to-stock-loop.test.js`. | 2026-11-07 |
| FR-007 | Verified by test | `stock-writes.test.js` (insufficient stock 409), `concurrency-issue-receive.test.js`. | 2026-11-07 |
| FR-008 | Verified by test | `stock-writes.test.js`, `concurrency-adjust.test.js`. "Authorized" is covered by the route matrix. | 2026-11-07 |
| FR-009 | Verified by test | `stock-writes.test.js`, `concurrency-reserve-release.test.js` (parallel reservations). | 2026-11-07 |
| FR-010 | Verified by test | `stock-writes.test.js`, `concurrency-reserve-release.test.js`. | 2026-11-07 |
| FR-011 | Verified by test | `stock-writes.test.js` (both ledger sides), `concurrency-transfer.test.js`, `review-fixes.test.js` (rollback). | 2026-11-07 |
| FR-012 | Verified by test | `integration/pagination.test.js` ("low-stock keeps count and only counts matching rows"); the dashboard low-stock KPI in `client/src/pages/Dashboard.test.tsx`. Note from CLAUDE.md: it compares in JavaScript, fine at this size. | 2026-11-07 |
| FR-013 | Verified by test | `procurement-writes.test.js`, `review-fixes.test.js` (parallel submit/approve: exactly one wins), `procure-to-stock-loop.test.js` (`approvedById` recorded). | 2026-11-07 |
| FR-014 | Verified by test | `procurement-writes.test.js`, `procurement-money.test.js` (exact totals and tax), `concurrency-po-cap.test.js`. | 2026-11-07 |
| FR-015 | Verified by test | `concurrency-goods-receipt.test.js` (parallel receipts cannot exceed the ordered quantity), `review-fixes.test.js` (rollback), `procure-to-stock-loop.test.js`. | 2026-11-07 |
| FR-016 | Verified by test | `procurement-writes.test.js` and `procurement-money.test.js` (invoice paid exactly = PAID, overpaid by one cent rejected). Known gap in CLAUDE.md: the cap against a PO is per invoice, not cumulative. | 2026-11-07 |
| FR-017, FR-018 | Verified by test | `integration/legacy-modules.test.js` (customers; sales order create, confirm once, second confirm 409). | 2026-11-07 |
| FR-019 to FR-024 | Out of scope | Sales release (Later). | 2026-11-07 |
| FR-025 to FR-030 | Out of scope | Later. | 2026-11-07 |
| FR-031 | Verified by test | `client/src/pages/Dashboard.test.tsx`; `docs/screenshots/verify/dashboard.png`, `models.png` (inventory and AI dashboards). | 2026-11-07 |
| FR-032 | Verified by test | `integration/route-access.test.js` (every declared route), `integration/verification-roles.test.js` (nine actions x four roles). | 2026-11-07 |
| FR-034 | Out of scope | Later. | 2026-11-07 |

## AI core (SRS section 5)

| ID | Status | Evidence / what is missing | Date |
|---|---|---|---|
| AI-001 | Verified by test | `ai-service/tests/test_series.py` (ISSUE quantities to daily demand, zero-filled days, series kept apart by product and warehouse, UTC+6 day boundary). | 2026-11-07 |
| AI-002 | Verified by test | `ai-service/tests/test_baseline_and_metrics.py`, `test_features_and_model.py`, `test_api_forecast.py` (baseline and ML forecast with sigma). The 30-day horizon is the default of the API; `docs/screenshots/verify/forecast.png` shows 30 forecast days. | 2026-11-07 |
| AI-003 | Verified by test | `ai-service/tests/test_evaluation.py`, `test_api_forecast.py`; MAE of both models and the policy in REPORT.md (regenerated identical); `integration/ai-models.test.js` (metrics and version recorded). Training time as a stored field was not checked separately. | 2026-11-07 |
| AI-004 | Verified by test | `unit/replenishment.test.js`; inputs stored with the suggestion: `integration/replenishment.test.js`. | 2026-11-07 |
| AI-005 | Verified by test | `unit/replenishment.test.js` (preferred, else lowest price among active suppliers). | 2026-11-07 |
| AI-006 | Verified by test | `integration/replenishment.test.js` (a new run expires older pending ones). The "at most one PENDING per product and warehouse" rule is a partial unique index in the migration SQL; no test attempts to violate it directly. | 2026-11-07 |
| AI-007 | Verified by test | `integration/suggestion-decisions.test.js` (one DRAFT requisition, linked, approver recorded, parallel double approve gives one requisition), `procure-to-stock-loop.test.js`. | 2026-11-07 |
| AI-008 | Verified by test | `ai-service/tests/test_anomaly_features_and_rules.py`, `test_anomaly_model.py`, `test_api_anomalies.py`, `test_anomaly_evaluation.py`; `integration/anomalies.test.js`. Result against the labels in the AI quality section above. | 2026-11-07 |
| AI-009 | Verified by test | `unit/explain-facts.test.js`, `integration/llm-explanations.test.js` (facts only, cached, null on failure, "Explanation unavailable"). A real Groq call for one case produced a correct explanation on 2026-11-06 (`npm run test:live`). | 2026-11-07 |
| AI-010 | Verified by test | `integration/assistant.test.js` (fixed read-only tool registry, no write call in tool code, hostile prompt changes nothing). | 2026-11-07 |
| AI-011 | Verified by test | `integration/ui-endpoints.test.js` (audit list), `suggestion-decisions.test.js`, `llm-explanations.test.js` (every LLM call audited with provider, model, outcome); `docs/screenshots/verify/audit.png`. | 2026-11-07 |
| AI-012 | Not verified | `unit/llm-provider.test.js` covers building a provider from config and the Groq to Gemini fallback; nothing checks that every listed environment variable changes behaviour end to end, and `LLM_PROVIDER` itself is not asserted. | 2026-11-07 |
| AI-013 | Verified by test | `integration/ai-models.test.js` (retrain is ADMIN only, 503 leaves the old model active), `ai-service/tests/test_registry_and_training.py` ("a new version does not disturb the previous one"). | 2026-11-07 |
| AI-014 | Out of scope | Later. | 2026-11-07 |

## Web interface and authentication (SRS section 6)

| ID | Status | Evidence / what is missing | Date |
|---|---|---|---|
| UI-001 | Verified by test | `client/src/pages/Login.test.tsx`, `client/e2e/smoke.spec.ts` (login, logout, wrong password, deep link blocked); `integration/auth.test.js` (JWT). | 2026-11-07 |
| UI-002 | Verified by test | `client/src/pages/Dashboard.test.tsx`; `docs/screenshots/verify/dashboard.png` (on hand, reserved, available, reorder level, days of cover, low-stock highlight). | 2026-11-07 |
| UI-003 | Verified by test | `client/src/pages/Forecast.test.tsx`; `docs/screenshots/verify/forecast.png` (90 days of history, baseline, ML, MAE 2.71 vs 1.71 for that series). | 2026-11-07 |
| UI-004 | Verified by test | `client/src/pages/Suggestions.test.tsx`; `docs/screenshots/verify/suggestions.png`, `suggestions-review.png`. | 2026-11-07 |
| UI-005 | Verified by test | `client/src/pages/Anomalies.test.tsx`; `docs/screenshots/verify/anomalies-rules.png`, `anomalies-queue.png` (separate tabs). | 2026-11-07 |
| UI-006 | Verified by test | `client/src/pages/Procurement.test.tsx`; screenshots `procurement-requisitions.png`, `procurement-orders.png`, `procurement-receipts.png`. | 2026-11-07 |
| UI-007 | Verified by test | `client/src/pages/Ledger.test.tsx`; `docs/screenshots/verify/ledger.png`; `integration/ui-endpoints.test.js` (date filters). | 2026-11-07 |
| UI-008 | Verified by test | `client/src/components/AssistantPanel.test.tsx`; `client/e2e/smoke.spec.ts` ("the assistant answers from the system data"). | 2026-11-07 |
| UI-009 | Verified by test | `client/src/components/ui.test.tsx` and the empty-state tests in the page test files; empty-state coverage was listed on 2026-11-06 (see the P7 report). | 2026-11-07 |
| AUTH-001 | Verified by test | `integration/auth.test.js` (bcrypt hash, 401 for missing, forged, expired and unsigned tokens, 429 limiter), `verification-roles.test.js` (403 by role). | 2026-11-07 |
| AUTH-002 | Verified by test | `integration/actor-attribution.test.js`, `suggestion-decisions.test.js`, `procure-to-stock-loop.test.js`. | 2026-11-07 |

## Non-functional requirements (SRS section 10)

| ID | Status | Evidence / what is missing | Date |
|---|---|---|---|
| NFR-001 | Verified by test, in part | Hashing, authentication, authorization and validation: `auth.test.js`, `route-access.test.js`, `validation.test.js`. "Secrets never committed": on 2026-11-07 no `.env` is tracked and a search of tracked files for Groq, Google and OpenAI-style key patterns found nothing; that is a pattern search, not a full secret scan. | 2026-11-07 |
| NFR-002 | Verified by test | `integration/inventory-constraints.test.js` (CHECK constraints), `validation.test.js`. | 2026-11-07 |
| NFR-003 | Verified by test | `concurrency-*.test.js` (issue, receive, adjust, reserve/release, transfer, goods receipt, PO cap), `review-fixes.test.js`. | 2026-11-07 |
| NFR-004 | Verified by test | `actor-attribution.test.js`, AI audit log (`ui-endpoints.test.js`); `docs/screenshots/verify/audit.png`. | 2026-11-07 |
| NFR-005 | Not verified | A structural claim (layers, AI provider behind an interface); no test or review was done in this pass. | 2026-11-07 |
| NFR-006 | Verified | Local latency table above: p95 18 ms or less on seven list endpoints. Local only; the hosted setup is not measured. | 2026-11-07 |
| NFR-007 | Verified by test | `review-fixes.test.js` (failed multi-item operations roll back completely), `prisma-errors.test.js`. | 2026-11-07 |
| NFR-008 | Verified by test, in part | `client/e2e/a11y.spec.ts` (axe: no serious violations; no sideways scroll on a phone-sized screen). Forms and feedback consistency was looked at in screenshots, not asserted. | 2026-11-07 |
| NFR-011 | Verified by test | AI service `GET /health` (`ai-service/tests/test_api_forecast.py`, `test_auth_and_config.py`). The ERP API had **no** health endpoint when this pass started; `GET /health` was added in this pass (`integration/health.test.js`, with a database ping). | 2026-11-07 |
| NFR-012 | Verified by test | `unit/explain-facts.test.js`, `llm-explanations.test.js` (the prompt carries computed facts only; a user's email is not sent). "Role-restricted data" is covered by the role matrix. | 2026-11-07 |
| NFR-013 | Verified by test | `client/src/components/ui.test.tsx`, `Suggestions.test.tsx`, `Anomalies.test.tsx`, `ai-service/tests/test_api_forecast.py`; `suggestions.png` (inputs, model version, "AI explanation" and "GROQ" source chips). | 2026-11-07 |
| NFR-014 | Verified by test | `integration/procure-to-stock-loop.test.js` (LLM key unset; LLM failing on every call), `llm-explanations.test.js`, `assistant.test.js`, `ai-models.test.js` (AI service down gives 503 on AI routes only). | 2026-11-07 |
| NFR-015 | Not verified | The LLM limits (20 per minute, 800 per day, cached explanations) are tested in `llm-explanations.test.js`; zero cost on free tiers cannot be checked before deployment. | 2026-11-07 |
| NFR-016 | Verified by test | `unit/seed-simulation.test.js`, `seed-prng-catalog.test.js` (identical data for a fixed seed), `ai-service/tests/test_registry_and_training.py` (same data gives the same version and predictions). | 2026-11-07 |

## Synthetic demo data (SRS section 11)

| ID | Status | Evidence | Date |
|---|---|---|---|
| SEED-001 | Verified by test | `unit/seed-prng-catalog.test.js`, `integration/seed-db.test.js`. | 2026-11-07 |
| SEED-002 | Verified by test | `unit/seed-prng-catalog.test.js`, `unit/seed-simulation.test.js`. | 2026-11-07 |
| SEED-003 | Verified by test | `unit/seed-simulation.test.js`. | 2026-11-07 |
| SEED-004 | Verified by test | `unit/seed-scenarios.test.js`; `anomaly-labels.json` holds 8 labels. | 2026-11-07 |
| SEED-005 | Verified by test | `unit/seed-simulation.test.js`, `integration/seed-db.test.js`, `integration/reconcile.test.js`; dev database reconcile OK. | 2026-11-07 |
| SEED-006 | Verified by test | `unit/seed-prng-catalog.test.js`, `seed-simulation.test.js`, `integration/seed-db.test.js`. | 2026-11-07 |
| SEED-007 | Verified by test | `unit/seed-scenarios.test.js`, `ai-service/tests/fixtures/scenarios.json`. | 2026-11-07 |
| SEED-008 | Verified by test | `client/src/components/Layout.test.tsx`, `Login.test.tsx` (synthetic-data footer); visible at the bottom of every screenshot. | 2026-11-07 |

## Defect register (SRS section 13), for reference

| ID | Status | Evidence | Date |
|---|---|---|---|
| D-01 | Verified | The client is the MVP UI and calls real endpoints: the page sweep opened 12 pages with no failed request. | 2026-11-07 |
| D-02 | Verified by test | `concurrency-*.test.js`. | 2026-11-07 |
| D-03 | Verified by test | `concurrency-goods-receipt.test.js`, `concurrency-po-cap.test.js`. | 2026-11-07 |
| D-04 | Out of scope | Deferred to the Sales release. | 2026-11-07 |
| D-05 | Verified by test | `unit/error-middleware.test.js`, `integration/prisma-errors.test.js`. | 2026-11-07 |
| D-06 | Verified by test | `integration/procurement-money.test.js`. | 2026-11-07 |
| D-07 | Verified by test | `integration/validation.test.js`, `pagination.test.js`. | 2026-11-07 |
| D-08 | Not verified | Authentication, tests and a filled README (9.8 KB) exist, there is no stray root `src/` folder. **Not resolved:** `server/prisma/migrations/20261003000000_phase_a_database_foundation/migration.sql` is a 32-byte file next to the real `20261002202429_phase_a_database_foundation`. It has been applied on existing databases, so it was left alone; removing it needs an owner decision. | 2026-11-07 |

## Observations from the page screenshots (not requirement failures)

* The floating "Ask the assistant" button sits over the right-hand "Details" button of a table row in the anomaly queue
  screenshot (`anomalies-queue.png`, row 4). It is a fixed button on a full-page capture, but on a real long table it can also cover the
  last column's action while that row is at the bottom-right of the window.
* The Models page and the evaluation report show different MAE figures because they are different data (see above).
