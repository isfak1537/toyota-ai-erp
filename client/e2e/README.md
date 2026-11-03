# End-to-end checks

These run against the **real stack**, not mocks. Start it first:

```
# terminal 1: database is running; ERP API
cd server && npm run dev                      # http://localhost:5001
# terminal 2: AI service
cd ai-service && .venv/bin/uvicorn app.main:app --port 8000
# terminal 3: this client (proxies /api to :5001)
cd client && npm run dev                      # http://localhost:5173
```

The demo users must exist (`cd server && npm run seed:users`) and the demo data be loaded
(`npm run seed:synthetic -- --apply`), with models trained and one replenishment run done
(log in as admin: AI models → Retrain; AI suggestions → Run replenishment).

The demo passwords are read from `server/.env` (only `DEMO_*_PASSWORD`), or from the environment
(`E2E_ENV_FILE` points at another file). Nothing is printed.

```
npm run e2e          # smoke test + automated accessibility check (read-only)
npm run screenshots  # regenerates docs/screenshots/*.png
```

The API limits login attempts to 10 per 15 minutes per user and address. The specs log in once per role
and page set; if you rerun them many times in a row, restart the API to clear the limit.
