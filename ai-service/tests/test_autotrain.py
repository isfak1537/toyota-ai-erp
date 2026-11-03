"""AI_AUTOTRAIN: hosts without a persistent disk (a free web service, a serverless function) lose trained models whenever
the instance restarts, so the service can train the missing ones itself when it starts."""

import pytest
from fastapi.testclient import TestClient

from app.config import ConfigError, Settings
from app.data.sources import CsvSource
from app.errors import ServiceError
from app.main import create_app
from app.registry import ModelRegistry
from tests.conftest import FIXTURES, SECRET

HEADERS = {"X-AI-Service-Secret": SECRET}


def settings(tmp_path, **extra):
    return Settings.from_env({"AI_SERVICE_SECRET": SECRET, "AI_MODEL_DIR": str(tmp_path / "models"), **extra})


@pytest.mark.parametrize("value, expected", [("true", True), ("TRUE", True), ("1", True), ("yes", True), ("", False), ("0", False), ("false", False), ("no", False)])
def test_the_setting_is_parsed_strictly(tmp_path, value, expected):
    assert settings(tmp_path, AI_AUTOTRAIN=value).autotrain is expected


def test_an_unclear_value_is_refused_rather_than_guessed(tmp_path):
    with pytest.raises(ConfigError, match="AI_AUTOTRAIN"):
        settings(tmp_path, AI_AUTOTRAIN="sometimes")


def test_it_is_off_by_default_and_nothing_is_trained_without_it(tmp_path):
    cfg = settings(tmp_path)

    with TestClient(create_app(cfg, source=CsvSource(FIXTURES), registry=ModelRegistry(cfg.model_dir))) as client:
        assert client.get("/health").json()["models"] == {"forecast": None, "anomaly": None}
        assert client.post("/forecast", json={"series": [{"productId": 2, "warehouseId": 2}]}, headers=HEADERS).status_code == 503


def test_with_it_on_both_models_are_ready_when_the_service_has_started(tmp_path):
    cfg = settings(tmp_path, AI_AUTOTRAIN="true")

    with TestClient(create_app(cfg, source=CsvSource(FIXTURES), registry=ModelRegistry(cfg.model_dir))) as client:
        models = client.get("/health").json()["models"]

        assert models["forecast"].startswith("forecast-20261101-") and models["anomaly"].startswith("anomaly-20261101-")
        forecast = client.post("/forecast", json={"series": [{"productId": 2, "warehouseId": 2}], "horizonDays": 7}, headers=HEADERS)
        assert forecast.status_code == 200 and forecast.json()["results"][0]["status"] == "OK"


def test_every_instance_that_trains_on_start_gets_the_same_versions(tmp_path):
    versions = []

    for name in ("instance-a", "instance-b"):
        cfg = settings(tmp_path / name, AI_AUTOTRAIN="true")

        with TestClient(create_app(cfg, source=CsvSource(FIXTURES), registry=ModelRegistry(cfg.model_dir))) as client:
            versions.append(client.get("/health").json()["models"])

    assert versions[0] == versions[1]  # deterministic training: a restarted or second instance converges


def test_models_that_already_exist_are_not_trained_again(tmp_path):
    cfg = settings(tmp_path, AI_AUTOTRAIN="true")
    registry = ModelRegistry(cfg.model_dir)

    with TestClient(create_app(settings(tmp_path), source=CsvSource(FIXTURES), registry=registry)) as client:  # autotrain off
        client.post("/train", json={"models": ["forecast"]}, headers=HEADERS)
        before = client.get("/health").json()["models"]

    assert before["anomaly"] is None

    with TestClient(create_app(cfg, source=CsvSource(FIXTURES), registry=registry)) as client:
        after = client.get("/health").json()["models"]

    assert after["forecast"] == before["forecast"]  # untouched
    assert after["anomaly"] is not None  # the missing one was trained


class BrokenSource(CsvSource):
    def __init__(self, error):
        super().__init__(FIXTURES)
        self.error = error

    def ledger(self, **filters):
        raise self.error


@pytest.mark.parametrize("error", [ServiceError("database is not reachable", 503), ConnectionError("connection refused"), RuntimeError("boom")])
def test_a_failure_to_train_never_stops_the_service_from_starting(tmp_path, error):
    cfg = settings(tmp_path, AI_AUTOTRAIN="true")

    with TestClient(create_app(cfg, source=BrokenSource(error), registry=ModelRegistry(cfg.model_dir))) as client:
        assert client.get("/health").json() == {**client.get("/health").json(), "status": "ok", "models": {"forecast": None, "anomaly": None}}
        assert client.post("/forecast", json={"series": [{"productId": 2, "warehouseId": 2}]}, headers=HEADERS).status_code == 503


def test_the_log_line_names_no_secret_or_connection_string(tmp_path, caplog):
    cfg = settings(tmp_path, AI_AUTOTRAIN="true", AI_DB_URL="postgresql://ai_readonly:hunter2@db.example.com/x")

    with caplog.at_level("INFO", logger="ai-service"):
        with TestClient(create_app(cfg, source=BrokenSource(ConnectionError("postgresql://ai_readonly:hunter2@db.example.com/x refused")), registry=ModelRegistry(cfg.model_dir))):
            pass

    assert "hunter2" not in caplog.text and "postgresql://" not in caplog.text
    assert "could not train forecast (ConnectionError)" in caplog.text
