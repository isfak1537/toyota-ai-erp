"""Where the ledger comes from.

Two interchangeable sources return the same frames:
  * CsvSource      - the committed fixtures (tests, notebooks, no database)
  * PostgresSource - the real database through the READ-ONLY role

Every SQL statement here is a plain SELECT of explicitly named columns (the role
only has column-level SELECT, and the service never writes business records).
Columns are returned in snake_case; created_at is a naive UTC datetime.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, Sequence

import pandas as pd

LEDGER_COLUMNS = [
    "id",
    "product_id",
    "warehouse_id",
    "type",
    "quantity",
    "balance_after",
    "reference_type",
    "reference_id",
    "created_at",
]

LEDGER_SQL = (
    'SELECT "id", "productId" AS product_id, "warehouseId" AS warehouse_id, "type"::text AS type, '
    '"quantity", "balanceAfter" AS balance_after, "referenceType" AS reference_type, '
    '"referenceId" AS reference_id, "createdAt" AS created_at '
    'FROM "InventoryTransaction"'
)
PRODUCTS_SQL = 'SELECT "id", "sku", "name" FROM "Product" ORDER BY "id"'
WAREHOUSES_SQL = 'SELECT "id", "code", "name" FROM "Warehouse" ORDER BY "id"'

LATEST_SQL = 'SELECT MAX("createdAt") AS latest FROM "InventoryTransaction"'

ALL_SQL = (LEDGER_SQL, PRODUCTS_SQL, WAREHOUSES_SQL, LATEST_SQL)


SeriesRef = tuple[int, int]  # (product_id, warehouse_id)


class LedgerSource(Protocol):
    def ledger(self, ids: Sequence[int] | None = None, series: Sequence[SeriesRef] | None = None) -> pd.DataFrame: ...

    def latest_timestamp(self) -> pd.Timestamp | None: ...

    def products(self) -> pd.DataFrame: ...

    def warehouses(self) -> pd.DataFrame: ...


def _normalise_ledger(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame[LEDGER_COLUMNS].copy()
    frame["created_at"] = pd.to_datetime(frame["created_at"], utc=True).dt.tz_localize(None)
    frame["quantity"] = frame["quantity"].astype("int64")
    frame["balance_after"] = frame["balance_after"].astype("int64")

    return frame.sort_values(["created_at", "id"], kind="stable").reset_index(drop=True)


class CsvSource:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def ledger(self, ids: Sequence[int] | None = None, series: Sequence[SeriesRef] | None = None) -> pd.DataFrame:
        raw = pd.read_csv(self.directory / "ledger.csv").rename(
            columns={
                "productId": "product_id",
                "warehouseId": "warehouse_id",
                "balanceAfter": "balance_after",
                "referenceType": "reference_type",
                "referenceId": "reference_id",
                "createdAt": "created_at",
            }
        )
        frame = _normalise_ledger(raw)

        if ids is not None:
            frame = frame[frame["id"].isin(list(ids))]

        if series is not None:
            wanted = pd.MultiIndex.from_tuples(list(series), names=["product_id", "warehouse_id"])
            frame = frame[pd.MultiIndex.from_frame(frame[["product_id", "warehouse_id"]]).isin(wanted)]

        return frame.reset_index(drop=True)

    def latest_timestamp(self) -> pd.Timestamp | None:
        ledger = self.ledger()

        return None if ledger.empty else ledger["created_at"].max()

    def products(self) -> pd.DataFrame:
        return pd.read_csv(self.directory / "products.csv")

    def warehouses(self) -> pd.DataFrame:
        return pd.read_csv(self.directory / "warehouses.csv")


class PostgresSource:
    """Reads through psycopg with a read-only session. Opens one short connection per call."""

    def __init__(self, db_url: str):
        self.db_url = db_url

    def _query(self, sql: str, params: Sequence | None = None) -> pd.DataFrame:
        import psycopg

        # read-only twice: the role is read-only, and so is this session
        with psycopg.connect(self.db_url, options="-c default_transaction_read_only=on") as connection:
            connection.read_only = True

            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                columns = [column.name for column in cursor.description]

                return pd.DataFrame(cursor.fetchall(), columns=columns)

    def ledger(self, ids: Sequence[int] | None = None, series: Sequence[SeriesRef] | None = None) -> pd.DataFrame:
        conditions, params = [], []

        if ids is not None:
            conditions.append('"id" = ANY(%s)')
            params.append(list(ids))

        if series is not None:
            if not series:
                return _normalise_ledger(pd.DataFrame(columns=LEDGER_COLUMNS))

            pairs = ", ".join(["(%s, %s)"] * len(series))
            conditions.append(f'("productId", "warehouseId") IN ({pairs})')
            params.extend(value for pair in series for value in (int(pair[0]), int(pair[1])))

        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        frame = self._query(f'{LEDGER_SQL}{where} ORDER BY "createdAt", "id"', params or None)

        return _normalise_ledger(frame)

    def latest_timestamp(self) -> pd.Timestamp | None:
        frame = self._query(LATEST_SQL)
        value = frame.iloc[0, 0] if not frame.empty else None

        return None if value is None or pd.isna(value) else pd.Timestamp(value)

    def products(self) -> pd.DataFrame:
        return self._query(PRODUCTS_SQL)

    def warehouses(self) -> pd.DataFrame:
        return self._query(WAREHOUSES_SQL)
