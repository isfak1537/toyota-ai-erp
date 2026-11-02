"""One global gradient-boosting model for all series (AI-002 b).

Why global: each series has about 60 usable days, far too little to learn
weekday and lag structure alone. Pooling the series lets the model learn the
shared weekday effect and how recent levels translate into future demand; the
level features keep series of different volume apart. Poisson loss suits
non-negative counts. Hyperparameters are fixed up front, not tuned on the
holdout.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from app.forecasting.features import FEATURE_NAMES, MIN_HISTORY, build_samples, forecast_frame, truncate

DEFAULT_PARAMS = {
    "loss": "poisson",
    "learning_rate": 0.05,
    "max_iter": 250,
    "max_depth": 4,
    "min_samples_leaf": 60,
    "l2_regularization": 1.0,
    "early_stopping": False,  # keeps training deterministic and uses all data
}
MAX_HORIZON = 30


@dataclass
class GlobalDemandModel:
    random_state: int = 0
    max_horizon: int = MAX_HORIZON
    params: dict = field(default_factory=lambda: dict(DEFAULT_PARAMS))
    estimator: HistGradientBoostingRegressor | None = None
    cutoff: pd.Timestamp | None = None
    n_samples: int = 0
    n_series: int = 0

    def fit(self, series: Mapping[tuple[int, int], pd.Series], cutoff: pd.Timestamp | str) -> "GlobalDemandModel":
        """Train on days up to and including `cutoff` only."""
        usable = truncate(series, pd.Timestamp(cutoff))
        samples = build_samples(usable, max_horizon=self.max_horizon)

        if samples.empty:
            raise ValueError("Not enough history to train the model")

        self.estimator = HistGradientBoostingRegressor(random_state=self.random_state, **self.params)
        self.estimator.fit(samples[FEATURE_NAMES], samples["y"])
        self.cutoff = pd.Timestamp(cutoff).normalize()
        self.n_samples = len(samples)
        self.n_series = len(usable)

        return self

    def can_forecast(self, history: pd.Series) -> bool:
        return self.estimator is not None and len(history) >= MIN_HISTORY

    def predict(self, history: pd.Series, horizon: int) -> np.ndarray:
        """Daily forecast for the `horizon` days after the last day of `history`."""
        if self.estimator is None:
            raise RuntimeError("The model has not been trained")

        if horizon > self.max_horizon:
            raise ValueError(f"horizon {horizon} exceeds the trained maximum of {self.max_horizon}")

        frame = forecast_frame(history, horizon)

        return np.clip(self.estimator.predict(frame[FEATURE_NAMES]), 0.0, None)
