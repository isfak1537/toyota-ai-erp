"""Which day a request is "as of"."""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.data.series import to_local_day
from app.data.sources import LedgerSource
from app.errors import ServiceError


def as_of_day(source: LedgerSource, tz_offset_hours: int, requested: dt.date | None) -> pd.Timestamp:
    """The requested local day, or the latest local day with data; never a day after the data."""
    latest = source.latest_timestamp()

    if latest is None:
        raise ServiceError("The ledger is empty", 409)

    latest_day = to_local_day(pd.Series([latest]), tz_offset_hours).iloc[0]

    if requested is None:
        return latest_day

    requested_day = pd.Timestamp(requested)

    if requested_day > latest_day:
        raise ServiceError(f"asOf {requested_day.date()} is after the latest ledger day {latest_day.date()}", 400)

    return requested_day


def end_of_local_day_utc(day: pd.Timestamp, tz_offset_hours: int) -> pd.Timestamp:
    """The UTC instant at which the local `day` ends (exclusive bound)."""
    return pd.Timestamp(day) + pd.Timedelta(days=1) - pd.Timedelta(hours=tz_offset_hours)
