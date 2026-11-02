import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

SECRET = "test-secret-with-enough-length"


@pytest.fixture()
def settings(tmp_path):
    return Settings.from_env(
        {"AI_SERVICE_SECRET": SECRET, "AI_MODEL_DIR": str(tmp_path / "models")}
    )


@pytest.fixture()
def client(settings):
    return TestClient(create_app(settings))


@pytest.fixture()
def auth():
    return {"X-AI-Service-Secret": SECRET}
