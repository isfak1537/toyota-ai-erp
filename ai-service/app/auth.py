"""Shared-secret authentication between the ERP API and this service."""

import hmac

from fastapi import Header, HTTPException, Request, status

SECRET_HEADER = "X-AI-Service-Secret"
PUBLIC_PATHS = frozenset({"/health"})
UNAUTHORIZED = "Missing or invalid service secret"


def secret_matches(provided: str | None, expected: str) -> bool:
    # constant-time comparison; a missing header and a wrong one look the same
    return provided is not None and hmac.compare_digest(provided.encode(), expected.encode())


def require_secret(
    request: Request,
    x_ai_service_secret: str | None = Header(default=None, alias=SECRET_HEADER),
) -> None:
    """Second layer: the middleware already rejects unauthenticated calls."""
    if not secret_matches(x_ai_service_secret, request.app.state.settings.service_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=UNAUTHORIZED)
