# AI service

Python FastAPI service for demand forecasting (AI-001..003) and anomaly
detection (AI-008). Internal API: only the ERP API calls it, with a shared
secret. It reads the database through a **read-only** role and never writes
business records.

## Setup

Python 3.11 or newer is required (3.12 or 3.13 recommended; developed and tested
on 3.13.5). Create the venv with an explicit interpreter:

```
cd ai-service
/path/to/python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt     # runtime + tests + notebooks
cp .env.example .env                              # then fill it in; never commit .env
```

> **macOS 26 gotcha:** Homebrew's Python 3.12.16 / 3.14.7 return an empty
> `platform.mac_ver()`, and pip then fails inside their venvs
> (`ValueError: invalid literal for int() with base 10: ''`, raised in
> `ensurepip`). Use a python.org or pyenv build instead. Do not rely on the
> `python3` on your PATH: it may be an older pyenv shim, and the service refuses
> to start below 3.11.

`requirements.txt` / `requirements-dev.txt` hold the pinned direct dependencies;
`requirements.lock.txt` is the full `pip freeze` of the tested environment.

## Database role (you run this)

`sql/create_ai_readonly_role.sql` creates `ai_readonly` with column-level
`SELECT` on the three tables the models read. Replace `CHANGE_ME`, run it as the
database owner, and put the same password in `AI_DB_URL` in `.env`.

## Run

```
.venv/bin/uvicorn app.main:app --reload --port 8000
```

`GET /health` is open (status only). Every other endpoint needs the header
`X-AI-Service-Secret: <AI_SERVICE_SECRET>`; a missing or wrong value is a 401.
The service refuses to start without a secret of at least 16 characters.

## Test

```
.venv/bin/pytest                  # unit + API tests (no database needed)
.venv/bin/pytest -m db            # needs AI_DB_URL (read-only role)
.venv/bin/pytest -m slow          # executes the notebooks
```

## API (internal, ERP API only)

| Endpoint | Purpose |
|---|---|
| `GET /health` | open; status, version, active model versions |
| `POST /forecast` | `{series:[{productId,warehouseId}], horizonDays 1-30, asOf?}` -> baseline, ML and selected daily forecast with sigma, holdout MAEs, 90 days of history |
| `POST /anomalies/score` | `{transactionIds}` or `{from,to}` (UTC, max 31 days) -> flags with score, source RULE/MODEL/BOTH, reason |
| `POST /train` | `{models:["forecast","anomaly"], asOf?}` -> trains, evaluates, registers and activates new versions |

Everything except `/health` returns 401 without the secret, including unknown paths; `/docs` and `/openapi.json` are off.

## Results

`REPORT.md` (generated) states the holdout and anomaly results honestly, including where the ML model and the
Isolation Forest fall short. `notebooks/01_forecast_eval.ipynb` and `notebooks/02_anomaly_eval.ipynb` show the charts
(history + baseline + ML forecast for the TREND_FAST and OVERSTOCKED demo products; detection per anomaly type).
Test data are CSV fixtures exported from the seed (`npm run seed:export-fixtures` in `server/`); the models never see
the anomaly labels.

## Time convention

Timestamps in the database are UTC. Business time is Asia/Dhaka (UTC+6,
`AI_TZ_OFFSET_HOURS`): business hours 08:00-17:00 local (02:00-11:00 UTC),
weekend Friday and Saturday. Daily demand buckets are local days. This matches
the synthetic data (CLAUDE.md).
