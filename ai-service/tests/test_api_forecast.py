import json
import re

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.data.series import daily_demand, series_map
from app.data.sources import CsvSource, PostgresSource
from app.forecasting.training import train_forecasting
from app.main import create_app
from app.registry import ModelRegistry
from tests.conftest import FIXTURES, SECRET

HEADERS = {"X-AI-Service-Secret": SECRET}


def ref(product_id, warehouse_id):
    return {"productId": product_id, "warehouseId": warehouse_id}


class CountingSource:
    """Wraps a source and records how the API asked for data."""

    def __init__(self, inner):
        self.inner = inner
        self.calls = []

    def ledger(self, **filters):  # forwards every filter, so it cannot drift from the source interface
        frame = self.inner.ledger(**filters)
        self.calls.append({"series": filters.get("series"), "rows": len(frame)})

        return frame

    def latest_timestamp(self):
        return self.inner.latest_timestamp()

    def products(self):
        return self.inner.products()

    def warehouses(self):
        return self.inner.warehouses()


def build_client(tmp_path, source=None):
    settings = Settings.from_env({"AI_SERVICE_SECRET": SECRET, "AI_MODEL_DIR": str(tmp_path / "models")})
    registry = ModelRegistry(settings.model_dir)
    app = create_app(settings, source=source or CsvSource(FIXTURES), registry=registry)

    return TestClient(app), registry


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("api")
    source = CountingSource(CsvSource(FIXTURES))
    client, registry = build_client(tmp, source)
    response = client.post("/train", json={}, headers=HEADERS)
    assert response.status_code == 200, response.text

    return client, registry, source, response.json()["trained"][0]


# ---- before and after training ---------------------------------------------------------------


def test_forecasting_before_any_training_is_a_clear_503(tmp_path):
    client, _ = build_client(tmp_path)

    response = client.post("/forecast", json={"series": [ref(1, 1)]}, headers=HEADERS)

    assert response.status_code == 503
    assert "POST /train first" in response.json()["detail"]


def test_training_registers_a_version_that_health_then_reports(trained):
    client, registry, _, outcome = trained

    assert outcome["kind"] == "forecast" and outcome["activated"] is True
    assert re.fullmatch(r"forecast-20261101-[0-9a-f]{8}", outcome["version"])
    assert set(outcome["metrics"]["overall"]) == {"baseline", "ml", "selected", "nested_selected", "seasonal_naive"}
    assert client.get("/health").json()["models"]["forecast"] == outcome["version"]
    assert registry.active_version("forecast") == outcome["version"]


# ---- the forecast contract (UI-003, AI-002, NFR-013) -------------------------------------------------


def test_a_forecast_answers_with_history_baseline_ml_and_the_model_that_was_chosen(trained):
    client, _, _, outcome = trained

    body = client.post("/forecast", json={"series": [ref(7, 1)], "horizonDays": 30}, headers=HEADERS).json()
    item = body["results"][0]

    assert body["modelVersion"] == outcome["version"] and item["modelVersion"] == outcome["version"]
    assert body["asOf"] == "2026-11-01" and body["horizonDays"] == 30
    assert item["status"] == "OK" and item["selectedModel"] in ("BASELINE", "ML")
    assert item["baselineWindow"] in (7, 14)
    assert item["inputs"] == {"historyDays": 90, "lastActualDate": "2026-11-01"}

    days = [row["date"] for row in item["forecast"]]
    assert days == [d.strftime("%Y-%m-%d") for d in pd.date_range("2026-11-02", periods=30)]
    assert len(item["history"]) == 90 and item["history"][-1]["date"] == "2026-11-01"

    for row in item["forecast"]:
        assert row["mean"] >= 0 and row["baseline"] >= 0 and row["ml"] >= 0
        assert row["mean"] in (row["baseline"], row["ml"])
        assert row["sigma"] == item["sigma"] > 0

    assert item["dailyMean"] == pytest.approx(np.mean([row["mean"] for row in item["forecast"]]))


def test_every_series_reports_the_model_and_errors_it_was_selected_with(trained):
    client, _, _, outcome = trained
    per_series = outcome["metrics"]["per_series"]
    refs = [ref(int(k.split(":")[0]), int(k.split(":")[1])) for k in per_series]

    results = client.post("/forecast", json={"series": refs, "horizonDays": 14}, headers=HEADERS).json()["results"]

    assert len(results) == 24
    for item in results:
        known = per_series[f"{item['productId']}:{item['warehouseId']}"]
        assert item["selectedModel"] == known["selected"]
        assert item["sigma"] == pytest.approx(known["sigma"])
        assert item["metrics"] == {"holdoutDays": 14, "maeBaseline": known["mae_baseline"], "maeMl": known["mae_ml"]}
        assert item["baselineWindow"] in (7, 14)


def test_a_batch_keeps_order_drops_duplicates_and_marks_unknown_series(trained):
    client, _, _, _ = trained

    results = client.post(
        "/forecast",
        json={"series": [ref(2, 1), ref(999, 1), ref(2, 1), ref(1, 1)], "horizonDays": 7},
        headers=HEADERS,
    ).json()["results"]

    assert [(r["productId"], r["warehouseId"], r["status"]) for r in results] == [
        (2, 1, "OK"),
        (999, 1, "NO_HISTORY"),
        (1, 1, "OK"),
    ]
    assert "forecast" not in results[1]


def test_a_request_reads_only_the_ledger_rows_of_the_series_it_asks_for(trained):
    client, _, source, _ = trained
    source.calls.clear()

    client.post("/forecast", json={"series": [ref(1, 1), ref(2, 2)]}, headers=HEADERS)

    assert source.calls == [{"series": [(1, 1), (2, 2)], "rows": source.calls[0]["rows"]}]
    assert 0 < source.calls[0]["rows"] < 600  # a small slice, not the whole 2978-row ledger


def test_horizon_controls_the_number_of_forecast_days(trained):
    client, _, _, _ = trained

    for horizon in (1, 7, 30):
        item = client.post("/forecast", json={"series": [ref(1, 1)], "horizonDays": horizon}, headers=HEADERS).json()["results"][0]
        assert len(item["forecast"]) == horizon


def test_the_forecast_is_deterministic(trained):
    client, _, _, _ = trained
    body = {"series": [ref(1, 1), ref(7, 1)], "horizonDays": 30}

    assert client.post("/forecast", json=body, headers=HEADERS).json() == client.post("/forecast", json=body, headers=HEADERS).json()


# ---- asOf ---------------------------------------------------------------------------------------------


def test_as_of_cuts_the_history_and_moves_the_forecast_start(trained):
    client, _, _, _ = trained

    item = client.post(
        "/forecast", json={"series": [ref(7, 1)], "horizonDays": 7, "asOf": "2026-10-20"}, headers=HEADERS
    ).json()["results"][0]

    assert item["inputs"]["lastActualDate"] == "2026-10-20"
    assert item["history"][-1]["date"] == "2026-10-20"
    assert item["forecast"][0]["date"] == "2026-10-21"


def test_as_of_after_the_latest_data_is_refused(trained):
    client, _, _, _ = trained

    response = client.post("/forecast", json={"series": [ref(1, 1)], "asOf": "2026-11-05"}, headers=HEADERS)

    assert response.status_code == 400 and "after the latest ledger day" in response.json()["detail"]


# ---- validation ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"series": []},
        {"series": [ref(1, 1)], "horizonDays": 0},
        {"series": [ref(1, 1)], "horizonDays": 31},
        {"series": [ref(1, 1)], "horizonDays": "soon"},
        {"series": [ref(0, 1)]},
        {"series": [ref(1, -3)]},
        {"series": [{"productId": 1}]},
        {"series": [ref(1, 1)], "asOf": "yesterday"},
        {"series": [ref(1, 1)], "surprise": True},
        {"series": [{**ref(1, 1), "sku": "x"}]},
        {"series": [ref(1, 1)] * 501},
    ],
)
def test_invalid_forecast_requests_are_422(trained, body):
    client, _, _, _ = trained

    assert client.post("/forecast", json=body, headers=HEADERS).status_code == 422


# ---- training -------------------------------------------------------------------------------------------------------


def test_only_one_training_run_at_a_time(tmp_path):
    client, _ = build_client(tmp_path)
    client.app.state.train_lock.acquire()

    try:
        response = client.post("/train", json={}, headers=HEADERS)
    finally:
        client.app.state.train_lock.release()

    assert response.status_code == 409 and "already in progress" in response.json()["detail"]
    assert client.post("/train", json={}, headers=HEADERS).status_code == 200


def test_retraining_never_interrupts_serving_and_the_old_version_stays_available(tmp_path):
    client, registry = build_client(tmp_path)
    first = client.post("/train", json={}, headers=HEADERS).json()["trained"][0]["version"]
    before = client.post("/forecast", json={"series": [ref(1, 1)]}, headers=HEADERS).json()

    second = client.post("/train", json={"asOf": "2026-10-25"}, headers=HEADERS).json()["trained"][0]["version"]

    assert second != first and "20261025" in second
    assert registry.active_version("forecast") == second
    assert set(registry.versions("forecast")) == {first, second}
    assert before["modelVersion"] == first
    assert client.post("/forecast", json={"series": [ref(1, 1)]}, headers=HEADERS).json()["modelVersion"] == second


def test_training_twice_on_the_same_data_keeps_the_same_version(tmp_path):
    client, registry = build_client(tmp_path)

    a = client.post("/train", json={}, headers=HEADERS).json()["trained"][0]["version"]
    b = client.post("/train", json={}, headers=HEADERS).json()["trained"][0]["version"]

    assert a == b and registry.versions("forecast") == [a]


@pytest.mark.parametrize(
    "body, status",
    [
        ({"models": ["forecast", "voodoo"]}, 422),
        ({"models": []}, 422),
        ({"asOf": "not-a-date"}, 422),
        ({"asOf": "2027-01-01"}, 400),
        ({"extra": 1}, 422),
    ],
)
def test_invalid_training_requests(tmp_path, body, status):
    client, _ = build_client(tmp_path)

    assert client.post("/train", json=body, headers=HEADERS).status_code == status


def test_training_without_a_database_configured_is_a_503():
    settings = Settings.from_env({"AI_SERVICE_SECRET": SECRET})  # no AI_DB_URL, no injected source
    client = TestClient(create_app(settings, registry=ModelRegistry(FIXTURES.parent / "does-not-exist")))

    response = client.post("/train", json={}, headers=HEADERS)

    assert response.status_code == 503 and "AI_DB_URL" in response.json()["detail"]


# ---- series the model has not seen ------------------------------------------------------------------------------------


def test_a_series_that_was_not_in_the_trained_model_gets_a_flagged_baseline(tmp_path):
    client, registry = build_client(tmp_path)
    ledger = CsvSource(FIXTURES).ledger()
    some = dict(list(series_map(daily_demand(ledger)).items())[:6])
    train_forecasting(some, registry)
    unseen = [key for key in series_map(daily_demand(ledger)) if key not in some][0]

    item = client.post("/forecast", json={"series": [ref(*unseen)], "horizonDays": 5}, headers=HEADERS).json()["results"][0]

    assert item["status"] == "OK" and item["selectedModel"] == "BASELINE"
    assert item["metrics"]["maeBaseline"] is None and item["metrics"]["maeMl"] is None
    assert any("not part of the trained model" in note for note in item["notes"])
    assert all(row["ml"] is not None for row in item["forecast"])  # ML is shown for comparison, just not chosen


# ---- the database source builds parameterised SQL ---------------------------------------------------------------------


def test_the_series_filter_is_parameterised_never_interpolated():
    captured = {}

    class Spy(PostgresSource):
        def _query(self, sql, params=None):
            captured.update(sql=sql, params=params)
            return pd.DataFrame(
                columns=["id", "product_id", "warehouse_id", "type", "quantity", "balance_after", "reference_type", "reference_id", "created_at"]
            )

    Spy("postgresql://unused").ledger(series=[(3, 4), (5, 6)], ids=[10])

    assert captured["sql"].count("%s") == 1 + 4  # one ANY(%s) plus four pair values
    assert captured["params"] == [[10], 3, 4, 5, 6]
    assert re.search(r"\b[3456]\b", captured["sql"]) is None  # none of the ids appear in the SQL text
    assert ";" not in captured["sql"] and "--" not in captured["sql"]
