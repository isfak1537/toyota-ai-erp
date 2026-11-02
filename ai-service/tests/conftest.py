from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.data.sources import CsvSource
from app.main import create_app
from app.registry import ModelRegistry

SECRET = "test-secret-with-enough-length"
FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def settings(tmp_path):
    return Settings.from_env(
        {"AI_SERVICE_SECRET": SECRET, "AI_MODEL_DIR": str(tmp_path / "models")}
    )


@pytest.fixture()
def source():
    return CsvSource(FIXTURES)


@pytest.fixture()
def client(settings, source):
    return TestClient(create_app(settings, source=source, registry=ModelRegistry(settings.model_dir)))


@pytest.fixture()
def auth():
    return {"X-AI-Service-Secret": SECRET}
