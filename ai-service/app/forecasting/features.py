"""Features for the ML demand model (AI-002 b).

Direct multi-horizon design: one sample is (origin day T, horizon h) and the
target is the demand on day T + h. Every feature is computed from the days up to
and including T, plus the calendar of the target day, which is known in advance.
There is no recursion (no predicted value is ever fed back as a lag) and no
information from after the origin can reach a feature.
"""

from __future__ import annotations

from typing import Mapping

import numpy as np
import pandas as pd

MIN_HISTORY = 28  # days of history needed before an origin can be used
WEEKEND_DAYS = (4, 5)  # Friday and Saturday (pandas: Monday = 0)

FEATURE_NAMES = [
    "horizon",
    "target_dow",
    "target_is_weekend",
    "mean_7",
    "mean_14",
    "mean_28",
    "std_14",
    "zero_share_14",
    "last_value",
    "rel_slope_28",
    "trend_ratio",
    "level_log",
    "dow_mean_4",
    "dow_last",
    "dow_ratio",
]

LEVEL_FLOOR = 0.1  # avoids dividing by ~0 for very quiet series


def origin_features(values: np.ndarray, origin: int) -> dict[str, float]:
    """Features that depend only on values[: origin + 1]."""
    past = values[: origin + 1]
    last7, last14, last28 = past[-7:], past[-14:], past[-28:]
    mean_28 = float(last28.mean())

    x = np.arange(len(last28), dtype="float64")
    slope = 0.0 if len(last28) < 2 else float(np.polyfit(x, last28, 1)[0])

    return {
        "mean_7": float(last7.mean()),
        "mean_14": float(last14.mean()),
        "mean_28": mean_28,
        "std_14": float(last14.std()),
        "zero_share_14": float((last14 == 0).mean()),
        "last_value": float(past[-1]),
        "rel_slope_28": slope / max(mean_28, LEVEL_FLOOR),
        "trend_ratio": float(last7.mean()) / max(mean_28, LEVEL_FLOOR),
        "level_log": float(np.log1p(mean_28)),
    }


def same_weekday_values(values: np.ndarray, origin_dow: int, origin: int, target_dow: int, count: int = 4) -> np.ndarray:
    """The most recent `count` values on the target's weekday, all at or before the origin."""
    latest = origin - ((origin_dow - target_dow) % 7)
    positions = [latest - 7 * k for k in range(count)]

    return np.asarray([values[p] for p in positions if 0 <= p <= origin], dtype="float64")


def horizon_features(
    values: np.ndarray, dates: pd.DatetimeIndex, origin: int, horizon: int, base: dict[str, float]
) -> dict[str, float]:
    origin_dow = int(dates[origin].day_of_week)
    target_dow = (origin_dow + horizon) % 7
    same = same_weekday_values(values, origin_dow, origin, target_dow)
    dow_mean = float(same.mean()) if same.size else base["mean_28"]
    dow_last = float(same[0]) if same.size else base["mean_28"]

    return {
        "horizon": float(horizon),
        "target_dow": float(target_dow),
        "target_is_weekend": float(target_dow in WEEKEND_DAYS),
        **base,
        "dow_mean_4": dow_mean,
        "dow_last": dow_last,
        "dow_ratio": dow_mean / max(base["mean_28"], LEVEL_FLOOR),
    }


def truncate(series: Mapping[tuple[int, int], pd.Series], cutoff: pd.Timestamp) -> dict[tuple[int, int], pd.Series]:
    """Drop every day after `cutoff`. This is what keeps a holdout out of training."""
    cutoff = pd.Timestamp(cutoff).normalize()

    return {key: values[values.index <= cutoff] for key, values in series.items() if (values.index <= cutoff).any()}


def build_samples(
    series: Mapping[tuple[int, int], pd.Series],
    max_horizon: int = 30,
    min_history: int = MIN_HISTORY,
) -> pd.DataFrame:
    """Training samples from every usable (origin, horizon) in every series.

    A target is only used if its day exists in the series, so truncating the
    series at a cutoff (see `truncate`) guarantees that no target, and therefore
    no feature, comes from after the cutoff.
    """
    rows = []

    for (product_id, warehouse_id), history in series.items():
        values = history.to_numpy(dtype="float64")
        dates = history.index
        n = len(values)

        for origin in range(min_history - 1, n - 1):
            base = origin_features(values, origin)

            for horizon in range(1, min(max_horizon, n - 1 - origin) + 1):
                row = horizon_features(values, dates, origin, horizon, base)
                row.update(
                    {
                        "y": float(values[origin + horizon]),
                        "product_id": product_id,
                        "warehouse_id": warehouse_id,
                        "origin_date": dates[origin],
                        "target_date": dates[origin + horizon],
                    }
                )
                rows.append(row)

    columns = FEATURE_NAMES + ["y", "product_id", "warehouse_id", "origin_date", "target_date"]

    return pd.DataFrame(rows, columns=columns)


def forecast_frame(history: pd.Series, horizon: int) -> pd.DataFrame:
    """Features for days 1..horizon after the last observed day of `history`."""
    values = history.to_numpy(dtype="float64")
    origin = len(values) - 1

    if len(values) < MIN_HISTORY:
        raise ValueError(f"Need at least {MIN_HISTORY} days of history, got {len(values)}")

    base = origin_features(values, origin)
    rows = [horizon_features(values, history.index, origin, h, base) for h in range(1, horizon + 1)]
    frame = pd.DataFrame(rows, columns=FEATURE_NAMES)
    frame["target_date"] = [history.index[origin] + pd.Timedelta(days=h) for h in range(1, horizon + 1)]

    return frame
