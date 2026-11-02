"""Holdout evaluation, model policy and uncertainty (AI-002, AI-003).

Protocol
  * holdout = the last 14 days; the origin is the day before it
  * baseline window (7 or 14) is chosen on the training part only
  * the global ML model is trained on days up to the origin only
  * both forecast the full 14 days from that origin
  * AI-003 policy: use the ML model whenever the series has at least 28 days of
    history, the baseline otherwise
  * the OLD rule (the lower holdout MAE per series) is still computed and reported,
    as "per_series_selection". It is optimistic (the winner is picked on the same
    14 noisy days it is scored on), so a nested estimate repeats the choice on an
    EARLIER 14-day window and scores it on the untouched holdout; on the synthetic
    data that estimate is worse than the policy, which is why the rule was replaced
  * sigma = RMSE of the policy model's holdout residuals, never below the Poisson
    spread of its own forecast
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Mapping

import numpy as np
import pandas as pd

from app.forecasting.baseline import CANDIDATE_WINDOWS, moving_average_forecast, select_window
from app.forecasting.features import MIN_HISTORY
from app.forecasting.metrics import Summary, mae, rmse, summarise
from app.forecasting.model import GlobalDemandModel

HOLDOUT_DAYS = 14

BASELINE = "BASELINE"
ML = "ML"


def choose(mae_baseline: float, mae_ml: float | None) -> str:
    """The OLD AI-003 rule, kept as a reference: the lower holdout MAE wins; ties and a missing ML score go to the baseline."""
    if mae_ml is None or not math.isfinite(mae_ml) or not math.isfinite(mae_baseline):
        return BASELINE

    return ML if mae_ml < mae_baseline else BASELINE


def policy_choice(ml_available: bool) -> str:
    """AI-003 policy: ML for any series long enough for it (at least 28 days), the baseline otherwise."""
    return ML if ml_available else BASELINE


def estimate_sigma(actual: np.ndarray, forecast: np.ndarray) -> float:
    """Daily forecast uncertainty: holdout RMSE, floored at the Poisson spread of the forecast."""
    floor = math.sqrt(max(float(np.mean(forecast)), 0.0))

    return max(rmse(actual, forecast), floor)


def seasonal_naive(train: np.ndarray, horizon: int) -> np.ndarray:
    """Same weekday, most recent week at or before the origin (reference only)."""
    n = len(train)

    return np.asarray([train[n - 1 + h - 7 * math.ceil(h / 7)] for h in range(1, horizon + 1)], dtype="float64")


@dataclass
class SeriesEvaluation:
    key: tuple[int, int]
    train_days: int
    baseline_window: int
    actual: np.ndarray
    baseline: np.ndarray
    ml: np.ndarray | None
    seasonal: np.ndarray
    mae_baseline: float
    mae_ml: float | None
    mae_ma7: float
    mae_ma14: float
    selected: str  # the AI-003 policy
    selected_by_mae: str  # the old rule: lower holdout MAE
    nested_by_mae: str  # the old rule, chosen on the earlier window
    sigma: float

    @property
    def selected_forecast(self) -> np.ndarray:
        return self.ml if self.selected == ML and self.ml is not None else self.baseline

    @property
    def by_mae_forecast(self) -> np.ndarray:
        return self.ml if self.selected_by_mae == ML and self.ml is not None else self.baseline

    @property
    def nested_forecast(self) -> np.ndarray:
        return self.ml if self.nested_by_mae == ML and self.ml is not None else self.baseline

    @property
    def ml_or_baseline(self) -> np.ndarray:
        return self.ml if self.ml is not None else self.baseline


@dataclass
class EvaluationResult:
    holdout_start: pd.Timestamp
    holdout_end: pd.Timestamp
    per_series: dict[tuple[int, int], SeriesEvaluation]
    skipped: list[tuple[int, int]]
    summaries: dict[str, Summary]
    ml_series: int
    selected_ml: int  # series on which the policy uses ML
    by_mae_ml: int  # the old rule would use ML
    nested_by_mae_ml: int
    model_samples: int = 0
    notes: list[str] = field(default_factory=list)

    def metrics(self) -> dict:
        """JSON-ready metrics for the registry and the report."""
        return {
            "holdout_days": HOLDOUT_DAYS,
            "holdout_start": self.holdout_start,
            "holdout_end": self.holdout_end,
            "series_evaluated": len(self.per_series),
            "series_skipped": len(self.skipped),
            "series_with_ml": self.ml_series,
            "policy_ml": self.selected_ml,
            "policy_baseline": len(self.per_series) - self.selected_ml,
            "per_series_selection_ml": self.by_mae_ml,
            "per_series_selection_nested_ml": self.nested_by_mae_ml,
            "training_samples": self.model_samples,
            "overall": {name: summary.as_dict() for name, summary in self.summaries.items()},
            "per_series": {
                f"{key[0]}:{key[1]}": {
                    "baseline_window": ev.baseline_window,
                    "mae_baseline": ev.mae_baseline,
                    "mae_ma7": ev.mae_ma7,
                    "mae_ma14": ev.mae_ma14,
                    "mae_ml": ev.mae_ml,
                    "selected": ev.selected,
                    "selected_by_mae": ev.selected_by_mae,
                    "nested_selected_by_mae": ev.nested_by_mae,
                    "sigma": ev.sigma,
                }
                for key, ev in sorted(self.per_series.items())
            },
            "notes": self.notes,
        }


def _split(values: pd.Series, cutoff: pd.Timestamp) -> tuple[pd.Series, pd.Series]:
    return values[values.index <= cutoff], values[values.index > cutoff]


def evaluate_forecasting(
    series: Mapping[tuple[int, int], pd.Series],
    holdout_days: int = HOLDOUT_DAYS,
    random_state: int = 0,
    candidate_windows=CANDIDATE_WINDOWS,
) -> EvaluationResult:
    if not series:
        raise ValueError("No series to evaluate")

    last_days = {values.index[-1] for values in series.values()}

    if len(last_days) != 1:
        # daily_demand() ends every series on the same as-of day; anything else
        # is a caller bug and would silently skew every holdout window
        raise ValueError("All series must end on the same day")

    last_day = last_days.pop()
    cutoff = last_day - pd.Timedelta(days=holdout_days)
    earlier_cutoff = cutoff - pd.Timedelta(days=holdout_days)

    model = GlobalDemandModel(random_state=random_state).fit(series, cutoff)
    earlier_model = None

    try:
        earlier_model = GlobalDemandModel(random_state=random_state).fit(series, earlier_cutoff)
    except ValueError:
        pass  # not enough history for a nested estimate: every nested choice falls back to the baseline

    def forecasts(train: pd.Series, fitted: GlobalDemandModel | None):
        window, _ = select_window(train.to_numpy(), candidate_windows, horizon=holdout_days)
        baseline = moving_average_forecast(train.to_numpy(), window, holdout_days)
        ml = fitted.predict(train, holdout_days) if fitted is not None and fitted.can_forecast(train) else None

        return window, baseline, ml

    evaluations: dict[tuple[int, int], SeriesEvaluation] = {}
    skipped = []

    for key in sorted(series):
        train, actual_series = _split(series[key], cutoff)

        if len(actual_series) != holdout_days or len(train) == 0:
            skipped.append(key)
            continue

        actual = actual_series.to_numpy()
        window, baseline, ml = forecasts(train, model)
        values = train.to_numpy()

        # nested choice: made on the 14 days BEFORE the holdout, with a model that never saw them
        train2, holdout2 = _split(train, earlier_cutoff)
        nested = BASELINE

        if len(holdout2) == holdout_days and len(train2) > 0 and earlier_model is not None:
            _, baseline2, ml2 = forecasts(train2, earlier_model)

            if ml2 is not None:
                nested = choose(mae(holdout2.to_numpy(), baseline2), mae(holdout2.to_numpy(), ml2))

        mae_baseline = mae(actual, baseline)
        mae_ml = mae(actual, ml) if ml is not None else None
        selected = policy_choice(ml is not None)
        selected_by_mae = choose(mae_baseline, mae_ml)
        chosen = ml if selected == ML and ml is not None else baseline

        evaluations[key] = SeriesEvaluation(
            key=key,
            train_days=len(train),
            baseline_window=window,
            actual=actual,
            baseline=baseline,
            ml=ml,
            seasonal=seasonal_naive(values, holdout_days),
            mae_baseline=mae_baseline,
            mae_ml=mae_ml,
            mae_ma7=mae(actual, moving_average_forecast(values, 7, holdout_days)),
            mae_ma14=mae(actual, moving_average_forecast(values, 14, holdout_days)),
            selected=selected,
            selected_by_mae=selected_by_mae,
            nested_by_mae=nested,
            sigma=estimate_sigma(actual, chosen),
        )

    if not evaluations:
        raise ValueError("No series has enough history for a holdout evaluation")

    def pairs(pick):
        return {key: (ev.actual, pick(ev)) for key, ev in evaluations.items()}

    summaries = {
        "baseline": summarise(pairs(lambda ev: ev.baseline)),
        "ml": summarise(pairs(lambda ev: ev.ml_or_baseline)),
        "policy": summarise(pairs(lambda ev: ev.selected_forecast)),
        "per_series_selection": summarise(pairs(lambda ev: ev.by_mae_forecast)),
        "per_series_selection_nested": summarise(pairs(lambda ev: ev.nested_forecast)),
        "seasonal_naive": summarise(pairs(lambda ev: ev.seasonal)),
    }

    ml_series = sum(1 for ev in evaluations.values() if ev.ml is not None)
    notes = [
        "'ml' and 'policy' use the baseline for series without an ML forecast (fewer than "
        f"{MIN_HISTORY} training days); with every series long enough they are identical.",
        "'per_series_selection' is the OLD AI-003 rule (lower holdout MAE per series) and is optimistic; "
        "'per_series_selection_nested' makes the same choice on an earlier 14-day window and scores it "
        "on the untouched holdout.",
    ]

    return EvaluationResult(
        holdout_start=cutoff + pd.Timedelta(days=1),
        holdout_end=last_day,
        per_series=evaluations,
        skipped=skipped,
        summaries=summaries,
        ml_series=ml_series,
        selected_ml=sum(1 for ev in evaluations.values() if ev.selected == ML),
        by_mae_ml=sum(1 for ev in evaluations.values() if ev.selected_by_mae == ML),
        nested_by_mae_ml=sum(1 for ev in evaluations.values() if ev.nested_by_mae == ML),
        model_samples=model.n_samples,
        notes=notes,
    )
