"""Moving-average baseline (AI-002 a).

The forecast is flat: the mean of the last `window` days of demand. It ignores
the weekday on purpose; it is the yardstick the ML model has to beat.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np

from app.forecasting.metrics import mae

CANDIDATE_WINDOWS = (7, 14)


def moving_average_forecast(history: Sequence[float], window: int, horizon: int) -> np.ndarray:
    """Mean of the last `window` values, repeated `horizon` times.

    With fewer than `window` observations it uses what exists. Never negative.
    """
    values = np.asarray(history, dtype="float64")

    if values.size == 0:
        raise ValueError("Cannot forecast from an empty history")

    if window < 1 or horizon < 1:
        raise ValueError("window and horizon must be at least 1")

    level = max(0.0, float(values[-window:].mean()))

    return np.full(horizon, level)


def backtest_mae(
    history: Sequence[float],
    window: int,
    horizon: int = 14,
    n_origins: int = 3,
    step: int = 7,
    min_history: int = 14,
) -> float | None:
    """Rolling-origin MAE of a window, using only `history`.

    Origins end `horizon`, `horizon + step`, ... days before the end of the
    history, so every forecast is scored against days that exist in the history
    and no origin ever sees its own target. Returns None when no origin has
    enough data.
    """
    values = np.asarray(history, dtype="float64")
    errors = []

    for k in range(n_origins):
        origin = len(values) - horizon - k * step  # first target day is values[origin]

        if origin < min_history:
            break

        forecast = moving_average_forecast(values[:origin], window, horizon)
        errors.append(mae(values[origin : origin + horizon], forecast))

    return float(np.mean(errors)) if errors else None


def select_window(
    history: Sequence[float],
    candidates: Sequence[int] = CANDIDATE_WINDOWS,
    horizon: int = 14,
    n_origins: int = 3,
    step: int = 7,
) -> tuple[int, dict[int, float | None]]:
    """Pick the window with the lowest backtest MAE on the training history.

    Ties (and histories too short to backtest) go to the longest window, which is
    the smoother and therefore safer choice. Returns (window, {window: mae}).
    """
    scores = {w: backtest_mae(history, w, horizon, n_origins, step) for w in candidates}
    usable = {w: s for w, s in scores.items() if s is not None}

    if not usable:
        return max(candidates), scores

    best = min(usable.values())
    winners = [w for w, s in usable.items() if s <= best + 1e-12]

    return max(winners), scores
