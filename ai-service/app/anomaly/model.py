"""Isolation Forest scoring plus flag assembly (AI-008).

The forest is unsupervised. Its raw anomaly score is mapped to [0, 1] as the
share of training transactions that scored lower, and a transaction is a model
flag when it lies in the top `contamination` share (0.5%, fixed up front; it is
not tuned on the labels).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from app.anomaly.features import MODEL_FEATURES, ReferenceStats, compute_features, fit_reference_stats
from app.anomaly.rules import apply_rules

CONTAMINATION = 0.005
FOREST_PARAMS = {"n_estimators": 300, "max_samples": 256, "contamination": "auto", "n_jobs": 1}

RULE = "RULE"
MODEL = "MODEL"
BOTH = "BOTH"


@dataclass
class AnomalyModel:
    stats: ReferenceStats
    forest: IsolationForest
    train_scores: np.ndarray  # sorted raw scores of the training transactions
    contamination: float
    tz_offset_hours: int
    random_state: int

    def raw_scores(self, features: pd.DataFrame) -> np.ndarray:
        """Higher means more anomalous."""
        return -self.forest.score_samples(features[MODEL_FEATURES].to_numpy())

    def score01(self, raw: np.ndarray) -> np.ndarray:
        """Share of training transactions that scored lower than each value."""
        return np.searchsorted(self.train_scores, raw, side="left") / len(self.train_scores)

    @property
    def flag_threshold(self) -> float:
        return 1.0 - self.contamination


def fit_anomaly_model(
    ledger: pd.DataFrame, tz_offset_hours: int = 6, random_state: int = 0, contamination: float = CONTAMINATION
) -> AnomalyModel:
    if ledger.empty:
        raise ValueError("Cannot train an anomaly model on an empty ledger")

    stats = fit_reference_stats(ledger)
    features = compute_features(ledger, stats, tz_offset_hours)
    forest = IsolationForest(random_state=random_state, **FOREST_PARAMS).fit(features[MODEL_FEATURES].to_numpy())
    raw = -forest.score_samples(features[MODEL_FEATURES].to_numpy())

    return AnomalyModel(
        stats=stats,
        forest=forest,
        train_scores=np.sort(raw),
        contamination=contamination,
        tz_offset_hours=tz_offset_hours,
        random_state=random_state,
    )


def explain(row: pd.Series) -> str:
    """Why the model finds a transaction unusual, in plain language."""
    parts = []

    if row["robust_z"] > 3:
        parts.append(
            f"{int(row['abs_qty'])} units is {row['abs_qty'] / max(row['ref_median'], 1):.1f}x the usual "
            f"{row['ref_median']:g} for this product and movement"
        )

    if row["off_hours_distance"] > 0:
        parts.append("it happened outside business hours")

    if row["repeat_within_10min"] == 1.0:
        parts.append("it repeats an identical movement within 10 minutes")

    if row["share_of_stock"] >= 0.5:
        parts.append(f"it moves {row['share_of_stock']:.0%} of the stock on hand")

    if row["manual_receipt_no_ref"] == 1.0 and row["ratio_to_median"] > 3:
        parts.append("it is a manual receipt without a document")

    if not parts:
        parts.append("an unusual combination of size, timing and movement type")

    return "Statistically unusual: " + "; ".join(parts)


def combine_flags(features: pd.DataFrame, model_score: np.ndarray, model_flag: np.ndarray, rules: pd.DataFrame) -> pd.DataFrame:
    """One row per transaction with rule and model results merged into a single flag."""
    out = features[["id", "product_id", "warehouse_id", "type", "quantity", "created_at"]].copy()
    out["model_score"] = model_score
    out["model_flag"] = model_flag.astype(bool)
    out = out.merge(rules, on="id", how="left")
    out["rule_flag"] = out["rule_codes"].notna()
    out["flagged"] = out["rule_flag"] | out["model_flag"]
    out["source"] = np.select(
        [out["rule_flag"] & out["model_flag"], out["rule_flag"], out["model_flag"]], [BOTH, RULE, MODEL], default=""
    )
    out["score"] = np.where(out["rule_flag"], np.maximum(out["rule_score"].fillna(0.0), out["model_score"]), out["model_score"])

    explained = features.set_index("id")
    reasons = []

    for _, row in out.iterrows():
        text = []

        if row["rule_flag"]:
            text.append(row["rule_reason"])

        if row["model_flag"] and not row["rule_flag"]:
            text.append(f"Model score {row['model_score']:.3f}. {explain(explained.loc[row['id']])}")

        reasons.append(" | ".join(text) if text else None)

    out["reason"] = pd.Series(reasons, index=out.index, dtype=object)  # None, not NaN, when nothing fired

    return out.sort_values(["created_at", "id"], kind="stable").reset_index(drop=True)


def score_ledger(model: AnomalyModel, ledger: pd.DataFrame) -> pd.DataFrame:
    """Score every transaction in `ledger` (it must include the earlier movements of its series)."""
    features = compute_features(ledger, model.stats, model.tz_offset_hours)
    model_score = model.score01(model.raw_scores(features))
    model_flag = model_score >= model.flag_threshold
    rules = apply_rules(features)

    return combine_flags(features, model_score, model_flag, rules)
