"""Request bodies of the internal API (camelCase, like the ERP API)."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    models: list[Literal["forecast", "anomaly"]] = Field(default_factory=lambda: ["forecast"], min_length=1)
    asOf: dt.date | None = None
