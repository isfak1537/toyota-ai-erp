"""Train, evaluate, register and activate the forecasting artifact (AI-003, AI-013)."""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import pandas as pd

from app.forecasting.baseline import CANDIDATE_WINDOWS, select_window
from app.forecasting.evaluate import HOLDOUT_DAYS, EvaluationResult, evaluate_forecasting, policy_choice
from app.forecasting.model import DEFAULT_PARAMS, MAX_HORIZON, GlobalDemandModel
from app.registry import ModelRegistry
from app.versioning import fingerprint_series, library_versions, make_version

KIND = "forecast"


@dataclass
class TrainOutcome:
    version: str
    metrics: dict
    path: Path
    evaluation: EvaluationResult
    activated: bool


def training_config(random_state: int, tz_offset_hours: int) -> dict:
    return {
        "holdout_days": HOLDOUT_DAYS,
        "candidate_windows": list(CANDIDATE_WINDOWS),
        "max_horizon": MAX_HORIZON,
        "model_params": DEFAULT_PARAMS,
        "random_state": random_state,
        "tz_offset_hours": tz_offset_hours,
    }


def _fallback_sigma(history: pd.Series) -> float:
    """A series too young to evaluate: spread of its recent demand, at least Poisson."""
    recent = history.to_numpy()[-28:]

    return max(float(recent.std()) if len(recent) > 1 else 0.0, math.sqrt(max(float(recent.mean()), 0.0)))


def train_forecasting(
    series: Mapping[tuple[int, int], pd.Series],
    registry: ModelRegistry,
    random_state: int = 0,
    tz_offset_hours: int = 6,
    activate: bool = True,
) -> TrainOutcome:
    as_of = max(values.index[-1] for values in series.values())
    config = training_config(random_state, tz_offset_hours)

    evaluation = evaluate_forecasting(series, random_state=random_state)

    # production model: refit on everything up to as_of; the metrics above come
    # from the holdout fit and are what the report quotes
    final_model = GlobalDemandModel(random_state=random_state).fit(series, as_of)

    per_series = {}

    for key, history in series.items():
        window, _ = select_window(history.to_numpy(), CANDIDATE_WINDOWS, horizon=HOLDOUT_DAYS)
        ev = evaluation.per_series.get(key)

        per_series[key] = {
            "baseline_window": window,
            # AI-003 policy: ML for any series with at least 28 days of history
            "selected": policy_choice(final_model.can_forecast(history)),
            "selected_by_mae": ev.selected_by_mae if ev else None,  # the old rule, for information only
            "sigma": ev.sigma if ev else _fallback_sigma(history),
            "mae_baseline": ev.mae_baseline if ev else None,
            "mae_ml": ev.mae_ml if ev else None,
            "evaluated": ev is not None,
        }

    version = make_version(KIND, as_of, {"data": fingerprint_series(series), "config": config})
    metrics = {"version": version, "as_of": as_of, **evaluation.metrics()}
    metadata = {
        "kind": KIND,
        "version": version,
        "as_of": as_of,
        "series": len(series),
        "config": config,
        "libraries": library_versions(),
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    artifact = {"model": final_model, "series": per_series, "as_of": as_of, "config": config}

    path = registry.save(KIND, version, artifact, metrics, metadata)

    if activate:
        registry.activate(KIND, version)

    return TrainOutcome(version=version, metrics=metrics, path=path, evaluation=evaluation, activated=activate)
