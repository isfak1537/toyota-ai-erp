"""Request bodies of the internal API (camelCase, like the ERP API)."""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SeriesRef(Strict):
    productId: int = Field(gt=0)
    warehouseId: int = Field(gt=0)


class ForecastRequest(Strict):
    series: list[SeriesRef] = Field(min_length=1, max_length=500)
    horizonDays: int = Field(default=30, ge=1, le=30)
    asOf: dt.date | None = None


class TrainRequest(Strict):
    models: list[Literal["forecast", "anomaly"]] = Field(default_factory=lambda: ["forecast", "anomaly"], min_length=1)
    asOf: dt.date | None = None


MAX_RANGE_DAYS = 31


def _utc(value: dt.datetime) -> pd.Timestamp:
    """Naive UTC; a timestamp without a zone is taken to be UTC already."""
    stamp = pd.Timestamp(value)

    return stamp.tz_convert("UTC").tz_localize(None) if stamp.tzinfo else stamp


class AnomalyScoreRequest(BaseModel):
    """Score transactions by id, or every transaction in a time range (UTC), not both."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    transactionIds: list[Annotated[int, Field(gt=0)]] | None = Field(default=None, min_length=1, max_length=5000)
    date_from: dt.datetime | None = Field(default=None, alias="from")
    date_to: dt.datetime | None = Field(default=None, alias="to")
    includeAll: bool = False

    @model_validator(mode="after")
    def exactly_one_selection(self):
        has_range = self.date_from is not None or self.date_to is not None

        if self.transactionIds is None and not has_range:
            raise ValueError("Give transactionIds, or both from and to")

        if self.transactionIds is not None and has_range:
            raise ValueError("Give transactionIds or a from/to range, not both")

        if has_range:
            if self.date_from is None or self.date_to is None:
                raise ValueError("A range needs both from and to")

            start, end = _utc(self.date_from), _utc(self.date_to)

            if end <= start:
                raise ValueError("to must be after from")

            if end - start > pd.Timedelta(days=MAX_RANGE_DAYS):
                raise ValueError(f"The range may span at most {MAX_RANGE_DAYS} days")

        return self

    def range_utc(self) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
        if self.date_from is None:
            return None, None

        return _utc(self.date_from), _utc(self.date_to)
