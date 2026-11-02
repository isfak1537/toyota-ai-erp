"""FastAPI application (SRS section 9, Python internal API).

Run:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import sys
import threading

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app import __version__
from app.auth import PUBLIC_PATHS, SECRET_HEADER, UNAUTHORIZED, require_secret, secret_matches
from app.config import Settings
from app.data.sources import LedgerSource, PostgresSource
from app.forecasting.service import ForecastService, ServiceError
from app.registry import ModelRegistry
from app.runtime import check_python
from app.schemas import ForecastRequest, TrainRequest

SERVICE_NAME = "toyota-erp-ai-service"


def create_app(
    settings: Settings | None = None,
    source: LedgerSource | None = None,
    registry: ModelRegistry | None = None,
) -> FastAPI:
    check_python()
    settings = settings or Settings.from_env(load_dotenv=True)
    registry = registry or ModelRegistry(settings.model_dir)

    # no /docs, /redoc or /openapi.json: they would publish the whole API to anyone
    app = FastAPI(
        title="Toyota AI ERP - AI service",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.registry = registry
    app.state.train_lock = threading.Lock()

    def ledger_source() -> LedgerSource:
        if source is not None:
            return source

        if not settings.db_url:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI_DB_URL is not configured")

        return PostgresSource(settings.db_url)

    def forecasting() -> ForecastService:
        return ForecastService(ledger_source(), registry, settings.tz_offset_hours)

    def as_http(error: ServiceError) -> HTTPException:
        return HTTPException(error.status, detail=str(error))

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        # Runs before routing and body parsing, so an unauthenticated caller can
        # never learn anything from validation errors or from which paths exist.
        if request.url.path not in PUBLIC_PATHS and not secret_matches(
            request.headers.get(SECRET_HEADER), settings.service_secret
        ):
            return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": UNAUTHORIZED})

        return await call_next(request)

    @app.get("/health")
    def health() -> dict:
        # open on purpose (hosting health checks); status and model versions only, no data
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "version": __version__,
            "python": ".".join(str(part) for part in sys.version_info[:3]),
            "models": {"forecast": registry.active_version("forecast")},
        }

    protected = APIRouter(dependencies=[Depends(require_secret)])

    @protected.post("/forecast")
    def forecast(body: ForecastRequest) -> dict:
        try:
            return forecasting().forecast(
                [(ref.productId, ref.warehouseId) for ref in body.series], body.horizonDays, body.asOf
            )
        except ServiceError as error:
            raise as_http(error) from error

    @protected.post("/anomalies/score")
    def score_anomalies() -> dict:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")

    @protected.post("/train")
    def train(body: TrainRequest) -> dict:
        if "anomaly" in body.models:
            raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, detail="Anomaly training is not implemented yet")

        # one retrain at a time; serving the previous model is never interrupted (AI-013)
        if not app.state.train_lock.acquire(blocking=False):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="A training run is already in progress")

        try:
            outcome = forecasting().train(body.asOf)
        except ServiceError as error:
            raise as_http(error) from error
        finally:
            app.state.train_lock.release()

        return {
            "trained": [
                {
                    "kind": "forecast",
                    "version": outcome.version,
                    "activated": outcome.activated,
                    "metrics": outcome.metrics,
                }
            ]
        }

    app.include_router(protected)

    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing this module
    # (tests, tooling) never requires the secret to be configured.
    if name == "app":
        return create_app()

    raise AttributeError(name)
