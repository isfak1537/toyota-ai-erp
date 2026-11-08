# Deployment

How to run the system on free hosting, and every setting it needs. Everything here is for a **demo**: synthetic data,
free tiers, one instance of each part. Free-tier limits change; the figures below were checked in the vendors'
documentation on 3 Nov 2026 and must be checked again when you deploy.

```
 browser ──► Vercel (static client) ──► Vercel function (ERP API, Express) ──► Neon Postgres
                                                  │  ▲                              ▲
                                                  │  └── Groq / Gemini (LLM)        │ read-only role
                                                  ▼                                 │
                                        AI service (FastAPI) ───────────────────────┘
```

| Part | Host | Why |
|---|---|---|
| Client (React) | Vercel, static | Free, global CDN, SPA rewrite and security headers in `client/vercel.json` |
| ERP API (Express + Prisma) | Vercel, one serverless function | Free; `server/api/index.js` exports the same Express app; `server/vercel.json` |
| AI service (FastAPI, scikit-learn) | **Render free web service** (recommended, see below) | Plain `uvicorn` process, the same as local; `ai-service/render.yaml` |
| Database | Neon (free) | Postgres with a pooled and a direct connection string |
| LLM | Groq (primary), Gemini (fallback) | Free API keys, OpenAI-compatible |

## 1. Environment variables

Names only here; values go into each host's dashboard (never into the repository). `server/.env.example`,
`client/.env.example` and `ai-service/.env.example` list the same names with comments. A test fails if code reads a
variable that this page does not mention.

### Client (Vercel project, root directory `client`)

| Variable | Required | Meaning |
|---|---|---|
| `VITE_API_URL` | yes (production) | Base URL of the ERP API, no `/api/v1`, no trailing slash, for example `https://your-erp-api.vercel.app`. Empty in development (the dev server proxies `/api`). It is public: it ends up in the JavaScript. |
| `VITE_DEV_API` | no | Development only: where the dev server forwards `/api` (default `http://localhost:5001`). |

### ERP API (Vercel project, root directory `server`)

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** URL (host contains `-pooler`). The running API uses it. |
| `DIRECT_DATABASE_URL` | for migrations | Neon **direct** URL. Only `prisma migrate deploy` uses it (`prisma.config.ts`). Set it on your own machine when you migrate; the function does not need it. |
| `TEST_DATABASE_URL` | tests only | A separate local database whose name ends in `_test`. Never set on a host. |
| `DB_POOL_MAX` | recommended | Connections per function instance. Use `2` on Vercel. Default 10. |
| `JWT_SECRET` | yes | At least 32 random characters. Changing it logs everybody out. |
| `JWT_EXPIRES_IN` | no | Token lifetime, default `8h`. |
| `CLIENT_URL` | yes | Browser origin(s) allowed to call the API: the client's URL, or several separated by commas. |
| `TRUST_PROXY` | yes on hosts | `1` behind Vercel, so each client has its own login-attempt budget. Leave empty on a bare server. |
| `DEMO_LOGIN_ENABLED` | no | Shows the one-click demo login buttons and enables `POST /api/v1/auth/demo-login`, which signs in as a seeded demo user **without a password**. Unset or empty: **on** when `NODE_ENV` is not `production`, **off** in production. `true` or `false` overrides that either way. For local use and the manager demo only: on any public URL make sure `NODE_ENV=production` **and** set it to `false` explicitly, so a missing `NODE_ENV` can never turn it on. |
| `PORT` | no | Local development only (default 5001). |
| `AI_SERVICE_URL` | yes | URL of the AI service, for example `https://toyota-erp-ai-service.onrender.com`. |
| `AI_SERVICE_SECRET` | yes | The shared secret; **must equal** the AI service's. At least 16 characters. |
| `AI_ALLOW_PLAIN_HTTP` | no | The API refuses to send the shared secret over plain `http` to a non-local AI service. Set `true` only for a trusted private network address. Default off. |
| `AI_TIMEOUT_MS` | no | Timeout of an AI request, default 15000. Raise to 70000 if the AI service is on a host that sleeps (see section 3). |
| `AI_TRAIN_TIMEOUT_MS` | no | Timeout of a training request, default 120000. |
| `REPLEN_Z` | no | Service-level factor, default 1.65 (about 95%). |
| `REPLEN_REVIEW_DAYS` | no | Review period in days, default 7. |
| `LLM_PROVIDER` | yes for explanations | `groq`, `gemini` or `ollama`. Empty switches the LLM off; everything else keeps working. |
| `LLM_MODEL` | with a provider | For Groq use `openai/gpt-oss-120b` (tool calling verified). |
| `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` | no | Used when the primary fails. |
| `GROQ_API_KEY` | with Groq | Free key from the Groq console. |
| `GEMINI_API_KEY` | with Gemini | Free key from Google AI Studio. |
| `OLLAMA_BASE_URL` | local only | Default `http://localhost:11434`. |
| `LLM_TIMEOUT_MS` | no | Default 15000. |
| `LLM_RATE_PER_MINUTE` / `LLM_RATE_PER_DAY` | no | Default 20 / 800, below Groq's free tier. |
| `DEMO_ADMIN_PASSWORD`, `DEMO_WAREHOUSE_PASSWORD`, `DEMO_PROCUREMENT_PASSWORD`, `DEMO_VIEWER_PASSWORD` | only when running `npm run seed:users` | Passwords of the four demo users, at least 12 characters each. Set them on **your machine** when you seed Neon, not on the function. |

### AI service (Render web service, root directory `ai-service`)

| Variable | Required | Meaning |
|---|---|---|
| `AI_SERVICE_SECRET` | yes | The same value as on the ERP API. The service refuses to start without it. |
| `AI_DB_URL` | yes | Connection string of the **read-only** role `ai_readonly` (see 4.3). |
| `AI_AUTOTRAIN` | yes on Render | `true`: train missing models when the service starts (see 3). |
| `AI_MODEL_DIR` | yes on Render | `/tmp/models` (the disk is not persistent). |
| `AI_TZ_OFFSET_HOURS` | no | Business time offset, default 6 (Asia/Dhaka). Must match the seed. |
| `PYTHON_VERSION` | Render | `3.13.5` (set in `render.yaml`). |

## 2. Neon (database)

1. Create a project and a database in the Neon console. Copy two connection strings from **Connect**: the **pooled**
   one (host contains `-pooler`) and the **direct** one (toggle "Connection pooling" off).
2. Apply the migrations from your machine, against the direct URL:

   ```
   cd server
   DIRECT_DATABASE_URL='<direct url>' npm exec prisma -- migrate deploy
   ```

   `migrate deploy` only applies committed migrations; it never resets or drops anything. Run it before every deploy
   that contains a new migration.
3. The running API uses the **pooled** URL (`DATABASE_URL`). That is safe here because every lock in the code is
   transaction-scoped (`pg_advisory_xact_lock`, `SELECT ... FOR UPDATE`), which transaction pooling supports.
4. Create the read-only role for the AI service. Edit `ai-service/sql/create_ai_readonly_role.sql`: replace `CHANGE_ME`
   with a new password and `toyota_erp` with your Neon database name, then run it in Neon's SQL editor (or `psql`) as the
   owner. The AI service's `AI_DB_URL` is the pooled URL with `ai_readonly` and that password as user and password.

### 2.1 Seeding Neon safely

The synthetic data generator refuses to touch a non-local database unless you say so, and prints which database it
is about to write to. Always dry-run first:

```
cd server
export DATABASE_URL='<direct url>'                        # the direct URL, for this one session
npm run seed:synthetic                                     # DRY RUN: shows target database and host, writes nothing
npm run seed:synthetic -- --apply --allow-remote           # writes; refuses if seed data already exists
DEMO_ADMIN_PASSWORD=... DEMO_WAREHOUSE_PASSWORD=... DEMO_PROCUREMENT_PASSWORD=... DEMO_VIEWER_PASSWORD=... npm run seed:users
npm run reconcile -- --scope seed                          # must say OK
```

`--replace` deletes exactly the `SYN-` rows (and the AI demo rows) and reloads them; it needs `--allow-remote` too and is
destructive, so read the dry run first. `npm run demo:prepare` (and `demo:undo`) also refuse a remote database without
`--allow-remote`. Never run any of this against a database that holds real data.

## 3. AI service host: Vercel Python or Render free?

I measured the service (`ai-service/scripts/measure_bundle.py`, Python 3.13, Linux x86-64 wheels):

| Measure | Result |
|---|---|
| Dependencies unpacked (numpy, pandas, scikit-learn, scipy, FastAPI, ...) | **358 MB** (10,789 files, including bytecode and test folders) |
| Same without bytecode and tests | 221 MB (3,509 files); zipped 68 MB |
| Largest packages | scipy 102 MB, pandas 73 MB, scikit-learn 44 MB, numpy 39 MB |
| Peak memory (train both models, forecast, score; fixture data) | **about 220 MB** |
| Import time / training from scratch / one forecast / scoring 3 weeks | 1.5 s / 3.4 s / 0.04 s / 0.26 s (on a laptop) |

Limits in the vendors' documentation (3 Nov 2026):

| | Vercel Hobby, Python function | Render free web service |
|---|---|---|
| Size | 500 MB uncompressed (it is 250 MB for other runtimes) | no limit stated |
| Memory | 2 GB / 1 vCPU | not stated on the pages I could read; widely documented as 512 MB: check |
| Time per request | 300 s | not limited |
| Idle behaviour | scales to zero, cold start of seconds | spins down after 15 minutes without traffic; the next request takes about a minute |
| Persistent disk | none (read-only except `/tmp`) | none ("Free services don't support persistent disks") |
| Hours | usage-based free allowance | 750 free instance hours a month per workspace |

What this means:

* **Size is not the problem.** The dependencies fit Vercel's 500 MB Python limit (my first estimate, based on a 250 MB
  limit, was wrong) and 220 MB of memory fits both hosts.
* **The real problem is the same on both: models must be trained where they run.** The service stores trained models on
  disk; neither host keeps a disk across restarts. `AI_AUTOTRAIN=true` makes the service train the missing models when
  it starts (a few seconds), reading the database through the read-only role. Training is deterministic, so every
  instance ends up with the same model versions. Retraining from the UI trains the instance that answers the request;
  on a host with several instances the others keep their own until they restart.
* **Recommendation: Render free web service.** It runs the exact command used locally (`uvicorn`), so there is nothing
  to adapt and nothing I could not test; memory has about 2x headroom on the 512 MB figure. The price is the cold start:
  after 15 idle minutes the first request waits about a minute plus a few seconds of training, longer than the ERP
  API's 15 s timeout, so that first AI request fails gracefully (503, "AI service is unavailable") and the next works.
  **Before a demo, open `https://<your-service>.onrender.com/health` about two minutes ahead**, or set `AI_TIMEOUT_MS`
  to `70000` on the API.
* **Vercel Python is a viable second choice**, with a few-second cold start and 2 GB of memory. I did not choose it
  because I could not test it here: Vercel finds the entry point by file name (`app.py`, `main.py`, ...) while this
  service builds its `app` lazily so tests can import it without the secret, and the read-only filesystem needs
  `AI_MODEL_DIR=/tmp/models`. If you want to try it, set `AI_AUTOTRAIN=true`, add a one-line `app.py` that does
  `from app.main import create_app; app = create_app()`, and expect to adjust.

## 4. Deploying, in this order

The checklist with exact clicks is `docs/release-checklist.md`. In short:

1. Neon: project, migrations, `ai_readonly` role, seed (section 2).
2. Render: blueprint from `ai-service/render.yaml`; set `AI_SERVICE_SECRET` and `AI_DB_URL`. Wait for `/health` to say `ok`
   with both models (they are trained on start).
3. Vercel, ERP API (root `server`): environment variables of section 1; deploy; check `/api/v1/auth/me` answers 401.
4. Vercel, client (root `client`): `VITE_API_URL` = the API's URL; deploy.
5. Put the client's URL into the API's `CLIENT_URL` and redeploy the API (CORS).
6. Check `DEMO_LOGIN_ENABLED` is `false` (and `NODE_ENV` is `production`) on the public API (`GET /api/v1/auth/demo-status` answers `{"enabled": false}`, and `POST /api/v1/auth/demo-login` answers 404). Then smoke test: log in as each role, run replenishment, ask the assistant a question.

## 5. Known limits of the hosted setup

* The login-attempt limiter and the LLM per-minute window are kept in memory, per function instance. The LLM daily cap
  is counted from the audit log and is shared.
* The API function waits for the AI service (and the LLM) inside one request; `maxDuration` is 120 s in
  `server/vercel.json` (Hobby allows up to 300 s).
* Free tiers pause or throttle (Neon scales to zero too; its first query after idle takes a moment).
* Everything is synthetic demo data. Do not put real company data on this setup.
