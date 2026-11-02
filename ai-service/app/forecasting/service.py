"""Serving forecasts from the active model (AI-002, NFR-013)."""

from __future__ import annotations

import datetime as dt
from typing import Sequence

import numpy as np
import pandas as pd

from app.data.asof import as_of_day
from app.data.series import daily_demand, series_map
from app.data.sources import LedgerSource
from app.errors import ServiceError
from app.forecasting.baseline import CANDIDATE_WINDOWS, moving_average_forecast, select_window
from app.forecasting.evaluate import BASELINE, HOLDOUT_DAYS, ML
from app.forecasting.training import KIND, TrainOutcome, _fallback_sigma, train_forecasting
from app.registry import ModelRegistry, RegistryError

HISTORY_DAYS = 90


class ForecastService:
    def __init__(self, source: LedgerSource, registry: ModelRegistry, tz_offset_hours: int = 6):
        self.source = source
        self.registry = registry
        self.tz_offset_hours = tz_offset_hours
        self._cache: tuple[str, tuple] | None = None

    def _active(self) -> tuple[str, dict, dict]:
        version = self.registry.active_version(KIND)

        if version is None:
            raise ServiceError("No active forecast model; POST /train first", 503)

        if self._cache is None or self._cache[0] != version:
            try:
                artifact, metrics, _ = self.registry.load(KIND, version)
            except RegistryError as error:
                raise ServiceError(str(error), 503) from error

            self._cache = (version, (artifact, metrics))

        artifact, metrics = self._cache[1]

        return version, artifact, metrics

    def active_version(self) -> str | None:
        return self.registry.active_version(KIND)

    def train(self, as_of: dt.date | None = None) -> TrainOutcome:
        day = as_of_day(self.source, self.tz_offset_hours, as_of)
        demand = daily_demand(self.source.ledger(), self.tz_offset_hours, as_of=day)

        if demand.empty:
            raise ServiceError("There is no demand history to train on", 409)

        return train_forecasting(series_map(demand), self.registry, tz_offset_hours=self.tz_offset_hours)

    def forecast(self, refs: Sequence[tuple[int, int]], horizon: int, as_of: dt.date | None = None) -> dict:
        version, artifact, _ = self._active()
        day = as_of_day(self.source, self.tz_offset_hours, as_of)
        wanted = list(dict.fromkeys(refs))
        demand = daily_demand(self.source.ledger(series=wanted), self.tz_offset_hours, as_of=day)
        histories = series_map(demand)

        return {
            "modelVersion": version,
            "asOf": day.strftime("%Y-%m-%d"),
            "horizonDays": horizon,
            "results": [self._one(key, histories.get(key), artifact, version, day, horizon) for key in wanted],
        }

    def _one(self, key, history, artifact, version, day, horizon) -> dict:
        base = {"productId": key[0], "warehouseId": key[1]}

        if history is None or len(history) == 0:
            return {**base, "status": "NO_HISTORY", "message": "No ledger history for this product and warehouse"}

        values = history.to_numpy()
        trained = artifact["series"].get(key)
        notes = []

        if trained is None:
            window, _ = select_window(values, CANDIDATE_WINDOWS, horizon=HOLDOUT_DAYS)
            trained = {
                "baseline_window": window,
                "selected": BASELINE,
                "sigma": _fallback_sigma(history),
                "mae_baseline": None,
                "mae_ml": None,
                "evaluated": False,
            }
            notes.append("Series was not part of the trained model; baseline forecast with a recent-spread sigma.")

        baseline = moving_average_forecast(values, trained["baseline_window"], horizon)
        model = artifact["model"]
        ml = model.predict(history, horizon) if model.can_forecast(history) else None

        if trained["selected"] == ML and ml is None:
            notes.append("ML was selected but the series is too short for it; using the baseline.")

        selected = ML if trained["selected"] == ML and ml is not None else BASELINE
        chosen = ml if selected == ML else baseline
        days = pd.date_range(day + pd.Timedelta(days=1), periods=horizon, freq="D")
        recent = history.iloc[-HISTORY_DAYS:]

        return {
            **base,
            "status": "OK",
            "modelVersion": version,
            "selectedModel": selected,
            "baselineWindow": int(trained["baseline_window"]),
            "dailyMean": float(np.mean(chosen)),
            "sigma": float(trained["sigma"]),
            "metrics": {
                "holdoutDays": HOLDOUT_DAYS,
                "maeBaseline": trained["mae_baseline"],
                "maeMl": trained["mae_ml"],
            },
            "inputs": {"historyDays": int(len(history)), "lastActualDate": history.index[-1].strftime("%Y-%m-%d")},
            "notes": notes,
            "history": [
                {"date": d.strftime("%Y-%m-%d"), "demand": float(v)} for d, v in recent.items()
            ],
            "forecast": [
                {
                    "date": d.strftime("%Y-%m-%d"),
                    "mean": float(chosen[i]),
                    "baseline": float(baseline[i]),
                    "ml": None if ml is None else float(ml[i]),
                    "sigma": float(trained["sigma"]),
                }
                for i, d in enumerate(days)
            ],
        }
