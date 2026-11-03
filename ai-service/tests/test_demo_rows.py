"""Rows staged by `npm run demo:prepare` / `demo:undo` (referenceType DEMO_PREPARE, DEMO_PREPARE_UNDO) are real
ledger rows, but they are not demand and not events to score. The AI service must behave exactly as if they
did not exist: demand series, anomaly scoring and queue, training, and the latest day of data."""

import shutil

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.data.series import daily_demand, last_local_day, series_map
from app.data.sources import EXCLUDED_REFERENCE_TYPES, LATEST_SQL, LEDGER_SQL, NOT_DEMO_SQL, CsvSource, PostgresSource
from app.main import create_app
from app.registry import ModelRegistry
from tests.conftest import FIXTURES, SECRET

HEADERS = {"X-AI-Service-Secret": SECRET}
DEMO_IDS = [900001, 900002, 900003, 900004]


@pytest.fixture(scope="module")
def base():
    return CsvSource(FIXTURES)


@pytest.fixture(scope="module")
def with_demo(tmp_path_factory):
    """The fixture ledger plus demo rows: some inside the history, some after its last day."""
    folder = tmp_path_factory.mktemp("with-demo")

    for name in ("products.csv", "warehouses.csv"):
        shutil.copy(FIXTURES / name, folder / name)

    ledger = pd.read_csv(FIXTURES / "ledger.csv")
    series = ledger[ledger["type"] == "ISSUE"].groupby(["productId", "warehouseId"]).size().idxmax()
    product, warehouse = int(series[0]), int(series[1])
    last_balance = int(ledger[(ledger["productId"] == product) & (ledger["warehouseId"] == warehouse)].iloc[-1]["balanceAfter"])

    rows = pd.DataFrame(
        [
            # a big drain inside the history window, which would otherwise be demand and an obvious anomaly
            [DEMO_IDS[0], product, warehouse, "ISSUE", -60, last_balance, "DEMO_PREPARE", None, "2026-10-15T05:00:00.000Z"],
            # drains after the last day of the data, like a real demo prepared "today"
            [DEMO_IDS[1], product, warehouse, "ISSUE", -45, last_balance, "DEMO_PREPARE", None, "2026-11-02T05:00:00.000Z"],
            [DEMO_IDS[2], product, warehouse, "ISSUE", -45, last_balance, "DEMO_PREPARE", None, "2026-11-02T05:03:00.000Z"],
            [DEMO_IDS[3], product, warehouse, "RECEIPT", 90, last_balance, "DEMO_PREPARE_UNDO", DEMO_IDS[1], "2026-11-03T05:00:00.000Z"],
        ],
        columns=ledger.columns,
    )
    pd.concat([ledger, rows], ignore_index=True).to_csv(folder / "ledger.csv", index=False)

    return CsvSource(folder)


def build(source, tmp_path):
    settings = Settings.from_env({"AI_SERVICE_SECRET": SECRET, "AI_MODEL_DIR": str(tmp_path / "models")})

    return TestClient(create_app(settings, source=source, registry=ModelRegistry(settings.model_dir)))


def test_the_excluded_types_are_exactly_the_two_demo_types():
    assert EXCLUDED_REFERENCE_TYPES == ("DEMO_PREPARE", "DEMO_PREPARE_UNDO")


def test_the_source_never_returns_demo_rows(base, with_demo):
    ledger = with_demo.ledger()

    assert not ledger["id"].isin(DEMO_IDS).any()
    assert not ledger["reference_type"].isin(EXCLUDED_REFERENCE_TYPES).any()
    assert len(ledger) == len(base.ledger()) == 2978
    assert with_demo.ledger(ids=DEMO_IDS).empty  # not even when asked for by id


def test_other_reference_types_are_untouched(base, with_demo):
    kept = with_demo.ledger()

    assert set(kept["reference_type"].dropna()) == set(base.ledger()["reference_type"].dropna())
    assert (kept["reference_type"] == "MANUAL_ISSUE").sum() > 0
    assert kept["reference_type"].isna().sum() == base.ledger()["reference_type"].isna().sum()


def test_the_latest_day_of_data_ignores_demo_rows(base, with_demo):
    assert with_demo.latest_timestamp() == base.latest_timestamp()
    assert last_local_day(with_demo.ledger(), 6) == last_local_day(base.ledger(), 6) == pd.Timestamp("2026-11-01")


def test_demand_series_are_identical_with_and_without_demo_rows(base, with_demo):
    expected = daily_demand(base.ledger(), tz_offset_hours=6)
    actual = daily_demand(with_demo.ledger(), tz_offset_hours=6)

    pd.testing.assert_frame_equal(actual.reset_index(drop=True), expected.reset_index(drop=True))
    assert {k: v.sum() for k, v in series_map(actual).items()} == {k: v.sum() for k, v in series_map(expected).items()}


def test_training_gives_the_same_versions_and_the_same_forecasts(base, with_demo, tmp_path):
    clean, dirty = build(base, tmp_path / "clean"), build(with_demo, tmp_path / "dirty")

    trained_clean = clean.post("/train", json={}, headers=HEADERS).json()["trained"]
    trained_dirty = dirty.post("/train", json={}, headers=HEADERS).json()["trained"]

    # versions are hashes of the data the model saw: identical data, identical version
    assert [t["version"] for t in trained_clean] == [t["version"] for t in trained_dirty]
    assert [t["metrics"].get("transactions") for t in trained_clean] == [t["metrics"].get("transactions") for t in trained_dirty]

    series = [{"productId": 2, "warehouseId": 2}, {"productId": 7, "warehouseId": 1}]
    a = clean.post("/forecast", json={"series": series, "horizonDays": 14}, headers=HEADERS).json()
    b = dirty.post("/forecast", json={"series": series, "horizonDays": 14}, headers=HEADERS).json()

    assert a == b


def test_demo_rows_are_not_scored_and_never_enter_the_review_queue(base, with_demo, tmp_path):
    clean, dirty = build(base, tmp_path / "clean"), build(with_demo, tmp_path / "dirty")
    clean.post("/train", json={"models": ["anomaly"]}, headers=HEADERS)
    dirty.post("/train", json={"models": ["anomaly"]}, headers=HEADERS)

    by_id = dirty.post("/anomalies/score", json={"transactionIds": DEMO_IDS, "includeAll": True}, headers=HEADERS).json()

    assert by_id["scored"] == 0 and by_id["notFoundIds"] == DEMO_IDS and by_id["flags"] == []

    window = {"from": "2026-10-10T00:00:00Z", "to": "2026-11-04T00:00:00Z", "includeAll": True}
    a = clean.post("/anomalies/score", json=window, headers=HEADERS).json()
    b = dirty.post("/anomalies/score", json=window, headers=HEADERS).json()

    assert not {f["inventoryTransactionId"] for f in b["flags"]} & set(DEMO_IDS)
    assert b == a  # the same flags, ranks, scores and queue as without the demo rows


def test_the_postgres_queries_filter_demo_rows_in_the_database(monkeypatch):
    seen = []
    source = PostgresSource("postgresql://unused")

    def fake(sql, params=None):
        seen.append(sql)

        return pd.DataFrame(columns=["id", "product_id", "warehouse_id", "type", "quantity", "balance_after", "reference_type", "reference_id", "created_at"])

    monkeypatch.setattr(source, "_query", fake)
    source.ledger()
    source.ledger(ids=[1], series=[(1, 1)], created_from=pd.Timestamp("2026-10-01"), created_to=pd.Timestamp("2026-11-01"))
    source.latest_timestamp()

    assert all(NOT_DEMO_SQL in sql for sql in seen if sql.startswith(LEDGER_SQL)), seen
    assert len([s for s in seen if NOT_DEMO_SQL in s]) == 3
    assert NOT_DEMO_SQL in LATEST_SQL
    assert "'DEMO_PREPARE'" in NOT_DEMO_SQL and "'DEMO_PREPARE_UNDO'" in NOT_DEMO_SQL and "IS NULL" in NOT_DEMO_SQL
