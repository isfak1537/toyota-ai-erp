import pytest
from fastapi.testclient import TestClient

from app.config import ConfigError, Settings
from app.main import create_app
from app.runtime import check_python

PROTECTED = ["/forecast", "/anomalies/score", "/train"]


def test_health_is_open_and_reveals_no_data(client):
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert set(body) == {"status", "service", "version", "python", "models"}
    assert body["models"] == {"forecast": None}  # nothing trained yet


@pytest.mark.parametrize("path", PROTECTED)
def test_missing_secret_is_401(client, path):
    assert client.post(path, json={}).status_code == 401


@pytest.mark.parametrize("path", PROTECTED)
def test_wrong_secret_is_401(client, path):
    response = client.post(path, json={}, headers={"X-AI-Service-Secret": "not-the-secret-at-all"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Missing or invalid service secret"}


@pytest.mark.parametrize("path", PROTECTED)
def test_secret_is_checked_before_the_body(client, path):
    # an invalid body with no secret must be a 401, never a 422 that leaks the schema
    assert client.post(path, content=b"not json", headers={"Content-Type": "application/json"}).status_code == 401


@pytest.mark.parametrize("path", ["/forecast", "/train"])
def test_a_wrong_secret_with_a_malformed_body_never_reveals_the_schema(client, path):
    response = client.post(
        path, json={"series": "not a list", "horizonDays": 9999}, headers={"X-AI-Service-Secret": "x" * 20}
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Missing or invalid service secret"}


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/nope", "/admin"])
def test_unauthenticated_callers_cannot_discover_routes_or_the_schema(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_the_generated_documentation_is_switched_off_even_with_the_secret(client, auth, path):
    assert client.get(path, headers=auth).status_code == 404


def test_health_stays_open_without_a_secret(client):
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("secret", ["", "short", "x" * 15, "   "])
def test_empty_prefix_and_near_misses_are_rejected(client, secret):
    assert client.post("/train", json={}, headers={"X-AI-Service-Secret": secret}).status_code == 401


def test_secret_with_the_same_prefix_is_rejected(client, auth):
    wrong = auth["X-AI-Service-Secret"] + "x"

    assert client.post("/train", json={}, headers={"X-AI-Service-Secret": wrong}).status_code == 401


def test_correct_secret_passes_authentication(client, auth):
    # authenticated but nothing trained yet: a service error, never a 401
    response = client.post("/forecast", json={"series": [{"productId": 1, "warehouseId": 1}]}, headers=auth)

    assert response.status_code == 503


@pytest.mark.parametrize("env", [{}, {"AI_SERVICE_SECRET": ""}, {"AI_SERVICE_SECRET": "too-short"}])
def test_service_refuses_to_start_without_a_strong_secret(env):
    with pytest.raises(ConfigError, match="AI_SERVICE_SECRET"):
        Settings.from_env(env)


def test_settings_never_expose_secrets_in_repr():
    settings = Settings.from_env(
        {"AI_SERVICE_SECRET": "a-long-enough-secret-value", "AI_DB_URL": "postgresql://u:pw@h/db"}
    )

    assert "a-long-enough-secret-value" not in repr(settings)
    assert "pw" not in repr(settings)


def test_settings_parse_the_environment(tmp_path):
    settings = Settings.from_env(
        {
            "AI_SERVICE_SECRET": "a-long-enough-secret-value",
            "AI_MODEL_DIR": str(tmp_path),
            "AI_TZ_OFFSET_HOURS": "5",
            "AI_DB_URL": " postgresql://u@h/db ",
        }
    )

    assert settings.model_dir == tmp_path
    assert settings.tz_offset_hours == 5
    assert settings.db_url == "postgresql://u@h/db"

    with pytest.raises(ConfigError, match="AI_TZ_OFFSET_HOURS"):
        Settings.from_env({"AI_SERVICE_SECRET": "a-long-enough-secret-value", "AI_TZ_OFFSET_HOURS": "six"})


def test_python_version_check_names_the_problem():
    check_python((3, 12, 1))
    check_python((3, 11, 0))

    with pytest.raises(RuntimeError, match=r"3\.11 or newer.*3\.10\.11.*python3\.12 -m venv"):
        check_python((3, 10, 11))


def test_importing_the_module_does_not_need_a_secret(monkeypatch):
    monkeypatch.delenv("AI_SERVICE_SECRET", raising=False)
    import importlib

    import app.main as main

    importlib.reload(main)
    assert callable(main.create_app)
