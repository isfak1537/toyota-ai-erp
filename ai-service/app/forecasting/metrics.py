"""Forecast accuracy metrics (AI-003)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np


def _arrays(actual: Sequence[float], predicted: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    y = np.asarray(actual, dtype="float64")
    yhat = np.asarray(predicted, dtype="float64")

    if y.shape != yhat.shape:
        raise ValueError(f"actual and predicted differ in length ({y.shape} vs {yhat.shape})")

    if y.size == 0:
        raise ValueError("Cannot score an empty forecast")

    return y, yhat


def mae(actual: Sequence[float], predicted: Sequence[float]) -> float:
    """Mean absolute error."""
    y, yhat = _arrays(actual, predicted)

    return float(np.mean(np.abs(y - yhat)))


def rmse(actual: Sequence[float], predicted: Sequence[float]) -> float:
    y, yhat = _arrays(actual, predicted)

    return float(np.sqrt(np.mean((y - yhat) ** 2)))


def bias(actual: Sequence[float], predicted: Sequence[float]) -> float:
    """Mean of (predicted - actual): positive means the forecast is too high."""
    y, yhat = _arrays(actual, predicted)

    return float(np.mean(yhat - y))


def wape(actual: Sequence[float], predicted: Sequence[float]) -> float:
    """Weighted absolute percentage error: sum|e| / sum(actual). NaN when there was no demand."""
    y, yhat = _arrays(actual, predicted)
    total = float(np.sum(np.abs(y)))

    return float(np.sum(np.abs(y - yhat)) / total) if total > 0 else float("nan")


@dataclass(frozen=True)
class Summary:
    """Accuracy over many series.

    macro_mae: the mean of the per-series MAEs (every series counts equally)
    micro_mae: MAE over all forecast days pooled (busy series count more)
    """

    series: int
    macro_mae: float
    micro_mae: float
    wape: float
    bias: float

    def as_dict(self) -> dict[str, float | int]:
        return {
            "series": self.series,
            "macro_mae": self.macro_mae,
            "micro_mae": self.micro_mae,
            "wape": self.wape,
            "bias": self.bias,
        }


def summarise(pairs: Mapping[object, tuple[Sequence[float], Sequence[float]]]) -> Summary:
    """pairs: {series key: (actual, predicted)}."""
    if not pairs:
        raise ValueError("No series to summarise")

    per_series = [mae(y, yhat) for y, yhat in pairs.values()]
    y_all = np.concatenate([np.asarray(y, dtype="float64") for y, _ in pairs.values()])
    yhat_all = np.concatenate([np.asarray(yhat, dtype="float64") for _, yhat in pairs.values()])

    return Summary(
        series=len(pairs),
        macro_mae=float(np.mean(per_series)),
        micro_mae=mae(y_all, yhat_all),
        wape=wape(y_all, yhat_all),
        bias=bias(y_all, yhat_all),
    )
