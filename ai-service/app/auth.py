"""Shared-secret authentication between the ERP API and this service."""

import hmac

from fastapi import Header, HTTPException, Request, status

SECRET_HEADER = "X-AI-Service-Secret"


def require_secret(
    request: Request,
    x_ai_service_secret: str | None = Header(default=None, alias=SECRET_HEADER),
) -> None:
    expected = request.app.state.settings.service_secret

    # constant-time comparison; a missing header and a wrong one look the same
    if x_ai_service_secret is None or not hmac.compare_digest(
        x_ai_service_secret.encode(), expected.encode()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid service secret",
        )
