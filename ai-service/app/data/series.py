"""Daily demand series (AI-001).

Demand is the quantity issued per product and warehouse per LOCAL day (UTC plus
the business offset, default +6), taken from ISSUE ledger rows only. Days
without issues are filled with zero, from the series' first movement up to the
as-of day. Nothing after the as-of day is ever used.
"""

from __future__ import annotations

import pandas as pd

SERIES_KEY = ["product_id", "warehouse_id"]


def to_local_day(created_at: pd.Series, tz_offset_hours: int = 6) -> pd.Series:
    """UTC timestamps -> local calendar date (midnight, naive)."""
    return (created_at + pd.Timedelta(hours=tz_offset_hours)).dt.normalize()


def last_local_day(ledger: pd.DataFrame, tz_offset_hours: int = 6) -> pd.Timestamp:
    if ledger.empty:
        raise ValueError("The ledger is empty")

    return to_local_day(ledger["created_at"], tz_offset_hours).max()


def daily_demand(
    ledger: pd.DataFrame,
    tz_offset_hours: int = 6,
    as_of: pd.Timestamp | str | None = None,
) -> pd.DataFrame:
    """Long frame [product_id, warehouse_id, date, demand], zero-filled.

    A series starts on the local day of its first ledger row (of any type) and
    ends on `as_of` (default: the last local day in the ledger). Rows created
    after `as_of` are ignored.
    """
    columns = SERIES_KEY + ["date", "demand"]

    if ledger.empty:
        return pd.DataFrame(columns=columns).astype(
            {"product_id": "int64", "warehouse_id": "int64", "demand": "float64"}
        )

    frame = ledger.assign(date=to_local_day(ledger["created_at"], tz_offset_hours))
    end = pd.Timestamp(as_of).normalize() if as_of is not None else frame["date"].max()
    frame = frame[frame["date"] <= end]

    if frame.empty:
        return pd.DataFrame(columns=columns)

    first_day = frame.groupby(SERIES_KEY)["date"].min()
    issues = (
        frame[frame["type"] == "ISSUE"]
        .assign(demand=lambda f: -f["quantity"].astype("float64"))
        .groupby(SERIES_KEY + ["date"])["demand"]
        .sum()
    )

    pieces = []

    for (product_id, warehouse_id), start in first_day.items():
        days = pd.date_range(start, end, freq="D")
        index = pd.MultiIndex.from_product([[product_id], [warehouse_id], days], names=SERIES_KEY + ["date"])
        values = issues.reindex(index, fill_value=0.0)
        pieces.append(values.reset_index())

    result = pd.concat(pieces, ignore_index=True)

    return result.sort_values(SERIES_KEY + ["date"], kind="stable").reset_index(drop=True)


def series_map(demand: pd.DataFrame) -> dict[tuple[int, int], pd.Series]:
    """{(product_id, warehouse_id): Series indexed by date}."""
    return {
        (int(product_id), int(warehouse_id)): group.set_index("date")["demand"]
        for (product_id, warehouse_id), group in demand.groupby(SERIES_KEY, sort=True)
    }
