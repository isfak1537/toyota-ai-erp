"""Settings from the environment. Nothing here is ever logged or returned."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MIN_SECRET_LENGTH = 16


class ConfigError(RuntimeError):
    """The service is misconfigured and must not start."""


@dataclass(frozen=True)
class Settings:
    service_secret: str = field(repr=False)
    db_url: str | None = field(default=None, repr=False)
    model_dir: Path = SERVICE_ROOT / "models"
    tz_offset_hours: int = 6

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None, load_dotenv: bool = False) -> "Settings":
        if load_dotenv:
            from dotenv import load_dotenv as _load

            _load(SERVICE_ROOT / ".env", override=False)

        source = os.environ if env is None else env
        secret = (source.get("AI_SERVICE_SECRET") or "").strip()

        # fail closed: an internal API without a secret must not come up
        if len(secret) < MIN_SECRET_LENGTH:
            raise ConfigError(
                f"AI_SERVICE_SECRET must be set to at least {MIN_SECRET_LENGTH} characters "
                "(see .env.example). Refusing to start without a shared secret."
            )

        model_dir = Path(source.get("AI_MODEL_DIR") or "models")

        if not model_dir.is_absolute():
            model_dir = SERVICE_ROOT / model_dir

        try:
            tz_offset = int(source.get("AI_TZ_OFFSET_HOURS") or 6)
        except ValueError as error:
            raise ConfigError("AI_TZ_OFFSET_HOURS must be an integer") from error

        return cls(
            service_secret=secret,
            db_url=(source.get("AI_DB_URL") or "").strip() or None,
            model_dir=model_dir,
            tz_offset_hours=tz_offset,
        )
