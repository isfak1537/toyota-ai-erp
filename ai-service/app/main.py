"""FastAPI application (SRS section 9, Python internal API).

Run:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import sys

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status

from app import __version__
from app.auth import require_secret
from app.config import Settings
from app.runtime import check_python

SERVICE_NAME = "toyota-erp-ai-service"


def create_app(settings: Settings | None = None) -> FastAPI:
    check_python()
    settings = settings or Settings.from_env(load_dotenv=True)

    app = FastAPI(title="Toyota AI ERP - AI service", version=__version__)
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict:
        # open on purpose (hosting health checks); status only, no data
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "version": __version__,
            "python": ".".join(str(part) for part in sys.version_info[:3]),
        }

    protected = APIRouter(dependencies=[Depends(require_secret)])

    def not_ready() -> None:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, detail="Not implemented yet")

    protected.add_api_route("/forecast", not_ready, methods=["POST"])
    protected.add_api_route("/anomalies/score", not_ready, methods=["POST"])
    protected.add_api_route("/train", not_ready, methods=["POST"])
    app.include_router(protected)

    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing this module
    # (tests, tooling) never requires the secret to be configured.
    if name == "app":
        return create_app()

    raise AttributeError(name)
