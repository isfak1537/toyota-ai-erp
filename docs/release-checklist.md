# Release checklist: the steps only you can do

Everything below needs your accounts, your keys or your decisions; none of it can be done from the repository. Commands run
on your own machine from the repository root. Where a value is secret, it says **secret**: type it into the host's
dashboard or your shell, never into a file that is committed. Background and the full variable list: `docs/deployment.md`.

Order matters: database → AI service → API → client → CORS.

## 0. Before anything

- [ ] **Review and merge `phase-7-release`** into `main` (and tag it, for example `i8-release`).
- [ ] **Put the repository on GitHub.** There is no remote yet:
  ```
  # create an empty repository on github.com (no README), then:
  git remote add origin git@github.com:<you>/<repo>.git
  git push -u origin main --tags
  ```
  Vercel and Render deploy from a Git repository. Keep it **private** if you prefer; both can read private repositories
  after you authorise them.
- [ ] Decide whether the project needs a licence file (there is none) and whether the repository should be public.
- [ ] Re-check the free-tier limits listed in `docs/deployment.md` section 3 on the vendors' pages; they change.

## 1. Accounts and keys

| Service | Where | What you need |
|---|---|---|
| GitHub | github.com | the repository above |
| Neon | neon.tech → Sign up | free project |
| Render | render.com → Sign up with GitHub | free web service |
| Vercel | vercel.com → Sign up with GitHub | two projects on the Hobby plan |
| Groq | console.groq.com → API Keys → Create API key | the key (**secret**) for explanations and the assistant |
| Google AI Studio (optional fallback) | aistudio.google.com/apikey → Create API key | the key (**secret**), only if you want Gemini as a fallback |

Generate two random secrets and keep them somewhere safe (a password manager); you will paste them more than once:

```
openssl rand -base64 48     # JWT_SECRET      (secret)
openssl rand -base64 36     # AI_SERVICE_SECRET (secret)
```

Choose four demo passwords of at least 12 characters (**secret**), one per demo user.

## 2. Neon (database)

1. **New Project** → name it, pick the region closest to you, keep Postgres 16/17. Note the database name (default `neondb`).
2. **Connect** (button on the project dashboard) and copy two strings (**secret**, they contain a password):
   - the **pooled** string: toggle *Connection pooling* **on**; the host contains `-pooler`.
   - the **direct** string: toggle it **off**.
3. Apply the migrations from your machine (this never drops or resets anything):
   ```
   cd server
   npm install
   DIRECT_DATABASE_URL='<direct string>' npm exec prisma -- migrate deploy
   ```
4. Create the AI service's read-only role. Open `ai-service/sql/create_ai_readonly_role.sql`, replace `CHANGE_ME` with a new
   password (**secret**) and `toyota_erp` with your Neon database name, then paste it into Neon → **SQL Editor** and run it.
   The AI service's `AI_DB_URL` is the **pooled** string with the user changed to `ai_readonly` and that password.
5. Seed the demo data (synthetic; a dry run first):
   ```
   cd server
   export DATABASE_URL='<direct string>'
   npm run seed:synthetic                             # dry run: check the target database it prints
   npm run seed:synthetic -- --apply --allow-remote
   DEMO_ADMIN_PASSWORD='...' DEMO_WAREHOUSE_PASSWORD='...' DEMO_PROCUREMENT_PASSWORD='...' DEMO_VIEWER_PASSWORD='...' npm run seed:users
   npm run reconcile -- --scope seed                  # must end with "Result: OK"
   unset DATABASE_URL
   ```

## 3. Render (AI service)

1. **New +** → **Web Service** → connect the GitHub repository.
2. Fill in exactly:

   | Field | Value |
   |---|---|
   | Root Directory | `ai-service` |
   | Runtime | Python 3 |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
   | Instance Type | **Free** |
   | Health Check Path | `/health` |

   (`ai-service/render.yaml` holds the same values; to use it as a Blueprint, Render expects the file at the repository root.)
3. **Environment** → add:

   | Key | Value |
   |---|---|
   | `PYTHON_VERSION` | `3.13.5` |
   | `AI_AUTOTRAIN` | `true` |
   | `AI_MODEL_DIR` | `/tmp/models` |
   | `AI_TZ_OFFSET_HOURS` | `6` |
   | `AI_SERVICE_SECRET` | the secret from step 1 (**secret**) |
   | `AI_DB_URL` | the read-only connection string from Neon step 4 (**secret**) |

4. **Create Web Service.** When the log says the service is live, open `https://<name>.onrender.com/health`. It must show
   `"status":"ok"` and **both model versions filled in** (it trains them on start, a few seconds). If a model is `null`, see the log.

## 4. Vercel: the API

1. **Add New… → Project** → import the repository.
2. **Root Directory:** `server`. Framework Preset: **Other**. Leave build and output settings at their defaults (installing
   runs `prisma generate`).
3. **Environment Variables** (Production): add every row below.

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** string (**secret**) |
   | `DB_POOL_MAX` | `2` |
   | `JWT_SECRET` | secret from step 1 (**secret**) |
   | `CLIENT_URL` | leave a placeholder (`http://localhost:5173`) for now; fixed in step 6 |
   | `TRUST_PROXY` | `1` |
   | `AI_SERVICE_URL` | `https://<name>.onrender.com` |
   | `AI_SERVICE_SECRET` | the same secret as on Render (**secret**) |
   | `AI_TIMEOUT_MS` | `70000` (the free Render service can take about a minute to wake up) |
   | `LLM_PROVIDER` | `groq` |
   | `LLM_MODEL` | `openai/gpt-oss-120b` |
   | `GROQ_API_KEY` | your Groq key (**secret**) |
   | `LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL`, `GEMINI_API_KEY` | optional Gemini fallback (**secret** key) |

4. Project **Settings → Functions → Function Region:** choose the one nearest your Neon region.
5. **Deploy.** Then check that `https://<api>.vercel.app/api/v1/auth/me` answers **401** (that proves the function, the
   routing and the database driver start). A 500 means an environment variable is missing: Vercel → Logs.

## 5. Vercel: the client

1. **Add New… → Project** → the same repository again.
2. **Root Directory:** `client`. Framework Preset: **Vite**.
3. **Environment Variable:** `VITE_API_URL` = `https://<api>.vercel.app` (no `/api/v1`, no trailing slash).
4. **Deploy.** Note the client URL.

## 6. Connect them (CORS)

- [ ] In the **API** project → Settings → Environment Variables: set `CLIENT_URL` to the client's URL (several URLs may be
      separated by commas, for example a custom domain and the `*.vercel.app` one). **Redeploy** the API (Deployments → ⋯ → Redeploy).
- [ ] Optional: tighten `connect-src 'self' https:` in `client/vercel.json` to `connect-src 'self' https://<api>.vercel.app`,
      commit, and let Vercel redeploy the client.

## 7. Custom domain (optional)

Vercel → the client project → **Settings → Domains → Add**; at your DNS provider create the record Vercel shows (a CNAME for a
subdomain, A records for the apex). Add the new URL to the API's `CLIENT_URL` and redeploy the API.

## 8. Smoke test (about 10 minutes, then again 5 minutes before the demo)

- [ ] Open `https://<ai>.onrender.com/health` and wait until it answers (the first call can take about a minute).
- [ ] Open the client, log in as **admin**: *AI models → Retrain models…* (the AI service already trained on start; this proves the
      API can reach it) and see two active models.
- [ ] Log in as **procurement officer**: *AI suggestions → Run replenishment*; open a suggestion; read its explanation.
- [ ] Log in as **warehouse manager**: *Anomalies → Score recent movements*.
- [ ] Ask the assistant "Which products will run out soonest?".
- [ ] Optionally stage the demo against Neon: `cd server && DATABASE_URL='<direct string>' npm run demo:prepare -- --apply --allow-remote`
      (needs `AI_SERVICE_URL` and `AI_SERVICE_SECRET` in your shell too); undo with `demo:undo -- --apply --allow-remote`.
- [ ] Follow `docs/demo-script.md` once end to end.

## 9. Things to remember

- **Keys live only in the hosts' dashboards** (and your local `.env` files, which are ignored by git). If one leaks, rotate it
  there (Groq console, Neon *Reset password*, regenerate `JWT_SECRET` and `AI_SERVICE_SECRET` on both sides) and redeploy.
- Changing `JWT_SECRET` logs everybody out. Changing `AI_SERVICE_SECRET` needs the same value on Render and Vercel.
- The Render free service sleeps after 15 idle minutes: **open its `/health` two minutes before any demo.**
- Neon scales to zero too: the first request after a quiet period is slower.
- Free quotas: Groq's free tier, Render's 750 hours a month, Vercel's Hobby limits. The app stops asking the language model
  after 20 requests a minute / 800 a day (adjustable) and keeps working without it.
- This is demo data. Do not load real company data into this setup.
