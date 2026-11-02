import os
import re
from pathlib import Path

import pandas as pd
import pytest

from app.data import sources
from app.data.series import daily_demand, last_local_day, series_map
from app.data.sources import ALL_SQL, LEDGER_COLUMNS, CsvSource

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def csv():
    return CsvSource(FIXTURES)


def test_csv_source_matches_the_database_shape(csv):
    ledger = csv.ledger()

    assert list(ledger.columns) == LEDGER_COLUMNS
    assert len(ledger) == 2978
    assert ledger["created_at"].dt.tz is None
    assert ledger["created_at"].is_monotonic_increasing
    assert set(ledger["type"]) >= {"ISSUE", "RECEIPT", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"}
    assert len(csv.products()) == 18
    assert list(csv.warehouses()["code"]) == ["SYN-MAIN", "SYN-DEPOT"]


def test_the_ledger_the_models_see_carries_no_anomaly_information(csv):
    assert not any("anomal" in column.lower() for column in csv.ledger().columns)


def test_csv_source_can_load_specific_transactions(csv):
    subset = csv.ledger(ids=[1, 5, 9])

    assert list(subset["id"]) == [1, 5, 9]


def test_the_fixture_ledger_is_a_continuous_balance_chain(csv):
    ledger = csv.ledger()
    affects = ledger["type"].isin(["RECEIPT", "ISSUE", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"])
    effect = ledger["quantity"].where(affects, 0)

    for _, group in ledger.assign(effect=effect).groupby(["product_id", "warehouse_id"]):
        assert (group["effect"].cumsum() == group["balance_after"]).all()


def test_the_fixture_gives_90_zero_filled_days_for_every_series(csv):
    ledger = csv.ledger()
    series = series_map(daily_demand(ledger, tz_offset_hours=6))

    assert len(series) == 24
    assert last_local_day(ledger, 6) == pd.Timestamp("2026-11-01")

    for values in series.values():
        assert len(values) >= 88
        assert values.index.is_monotonic_increasing
        assert (values.index.to_series().diff().dropna() == pd.Timedelta(days=1)).all()
        assert (values >= 0).all()


def test_the_busiest_series_has_plausible_daily_demand(csv):
    series = series_map(daily_demand(csv.ledger()))
    products = csv.products().set_index("sku")["id"]
    oil_filter = series[(int(products["SYN-ENG-001"]), 1)]

    assert 8 < oil_filter.mean() < 20


# ---- the data layer only ever reads ---------------------------------------


@pytest.mark.parametrize("sql", ALL_SQL)
def test_every_statement_is_a_plain_select_of_named_columns(sql):
    assert sql.lstrip().upper().startswith("SELECT")
    assert "*" not in sql
    assert not re.search(r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COPY)\b", sql, re.I)


def test_the_source_module_contains_no_write_statements():
    text = Path(sources.__file__).read_text()
    statements = re.findall(r"""["']\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\s""", text, re.I)

    assert statements == []


def test_the_postgres_source_sets_a_read_only_session():
    text = Path(sources.__file__).read_text()

    assert "default_transaction_read_only=on" in text
    assert "read_only = True" in text


@pytest.mark.db
def test_the_database_role_can_read_but_not_write():
    from dotenv import dotenv_values
    import psycopg

    url = os.environ.get("AI_DB_URL") or dotenv_values(Path(__file__).parent.parent / ".env").get("AI_DB_URL")

    if not url:
        pytest.skip("AI_DB_URL is not configured")

    source = sources.PostgresSource(url)
    ledger = source.ledger()

    assert list(ledger.columns) == LEDGER_COLUMNS
    assert len(ledger) > 0

    with psycopg.connect(url) as connection:
        with connection.cursor() as cursor:
            with pytest.raises(psycopg.Error):
                cursor.execute('UPDATE "InventoryTransaction" SET "quantity" = "quantity" WHERE FALSE')
            connection.rollback()
            with pytest.raises(psycopg.Error):
                cursor.execute('SELECT "reason" FROM "InventoryTransaction" LIMIT 1')
