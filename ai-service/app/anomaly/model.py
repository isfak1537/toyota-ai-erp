"""Isolation Forest risk score, review queue and flag assembly (AI-008).

The forest is unsupervised and is trained only on ELIGIBLE transactions (stock
movements that are not document-linked receipts). Its raw score is mapped to a
risk score in [0, 1]: the share of training transactions that scored lower.

There is no binary cut. Instead the transactions of each period (a local week by
default) are ranked by risk, and the top N of each period form a review queue
(N = 10 per week, chosen up front as roughly two reviews per working day).
Every queue entry carries its risk score and the features that contribute most
to it. The transparent rules (R1-R5) flag independently of the queue.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from app.anomaly.features import MODEL_FEATURES, ReferenceStats, compute_features, fit_reference_stats
from app.anomaly.rules import apply_rules

FOREST_PARAMS = {"n_estimators": 300, "max_samples": 256, "contamination": "auto", "n_jobs": 1}
QUEUE_SIZE = 10  # per period, fixed a priori
QUEUE_PERIOD = "week"
PERIODS = ("week", "day")
TOP_FEATURES = 3
MIN_CONTRIBUTION = 1e-3  # raw-score drop below which a feature is not worth naming

RULE = "RULE"
MODEL = "MODEL"
BOTH = "BOTH"

# feature -> (plain description, underlying column to show, how to turn the model value back into units)
_identity = lambda value: value
FEATURE_LABELS = {
    "log_abs_qty": ("movement size in units", "abs_qty", np.expm1),
    "robust_z": ("size against the usual for this product (robust z)", "robust_z", _identity),
    "ratio_to_median": ("size as a multiple of the usual", "ratio_to_median", _identity),
    "share_of_stock": ("share of the stock on hand that moved", "share_of_stock", _identity),
    "off_hours_distance": ("hours outside business hours", "off_hours_distance", _identity),
    "is_weekend": ("happened on a weekend day (Fri/Sat)", "is_weekend", _identity),
    "log_gap_prev_min": ("minutes since the previous movement", "gap_prev_min", np.expm1),
    "repeat_within_10min": ("repeats an identical movement within 10 minutes", "repeat_within_10min", _identity),
    "manual_receipt_no_ref": ("manual receipt without a document", "manual_receipt_no_ref", _identity),
}


def feature_label(name: str) -> tuple[str, str, object]:
    if name in FEATURE_LABELS:
        return FEATURE_LABELS[name]

    kind = name.removeprefix("type_")

    return (f"movement type {kind.replace('_', ' ').lower()}", name, _identity)


def _duration(minutes: float) -> str:
    """'4 minutes', '3.5 hours', '2.5 days'."""
    if minutes < 90:
        return f"{minutes:.0f} minute{'' if round(minutes) == 1 else 's'}"

    if minutes < 48 * 60:
        return f"{minutes / 60:.1f} hours"

    return f"{minutes / 1440:.1f} days"


def _article(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


# One plain sentence per feature, written for a warehouse manager. The numbers are the same ones the
# flag carries as `value` and `typical`; only the wording changes. `value` and `typical` are in the units
# of the underlying column (see FEATURE_LABELS), never in the model's internal log scale.
def describe_feature(name: str, value: float, typical: float) -> str:
    if name == "log_abs_qty":
        return f"It moved {value:g} unit{'' if value == 1 else 's'}; a typical movement is about {typical:g}."

    if name == "ratio_to_median":
        if value >= 1:
            return f"Its size is {value:.1f} times the usual size for this product."

        return f"Its size is only {value:.0%} of the usual size for this product."

    if name == "robust_z":
        if abs(value) < 1:
            return f"Its size is close to the usual for this product ({abs(value):.1f} steps from normal)."

        side, way = ("above", "large") if value > 0 else ("below", "small")
        strength = "unusually" if abs(value) >= 3 else "somewhat"

        return f"Its size is {strength} {way} for this product: {abs(value):.1f} steps {side} normal (3 or more counts as unusual)."

    if name == "share_of_stock":
        if typical >= 0.01:
            return f"It moved {value:.0%} of the stock on hand (typically {typical:.0%})."

        return f"It moved {value:.0%} of the stock on hand."

    if name == "off_hours_distance":
        if value > 0:
            return f"It happened {value:.1f} hour{'' if value == 1 else 's'} outside business hours (08:00 to 17:00); most movements happen inside them."

        return "It happened inside business hours."

    if name == "is_weekend":
        return "It happened on a weekend day (Friday or Saturday); most movements do not." if value >= 0.5 else "It happened on a working day."

    if name == "log_gap_prev_min":
        if value >= 99_999:
            return "It is the first movement of this product in this warehouse."

        return f"It came {_duration(value)} after the previous movement of this product here (typically {_duration(typical)})."

    if name == "repeat_within_10min":
        return (
            "It repeats the movement just before it (same product, warehouse, type and quantity) within 10 minutes, which can be a double entry."
            if value >= 0.5
            else "It does not repeat the movement before it."
        )

    if name == "manual_receipt_no_ref":
        return (
            "It is a manual receipt with no purchase order or goods receipt behind it."
            if value >= 0.5
            else "It is not a manual receipt without a document."
        )

    kind = name.removeprefix("type_").replace("_", " ").lower()

    if value >= 0.5 and typical < 0.5:
        return f"It is {_article(kind)} {kind}, an uncommon kind of movement for this product."

    if value < 0.5 and typical >= 0.5:
        return f"It is not {_article(kind)} {kind}, the most common kind of movement."

    return f"The movement type is {'' if value >= 0.5 else 'not '}{kind}."


@dataclass
class AnomalyModel:
    stats: ReferenceStats
    forest: IsolationForest
    train_scores: np.ndarray  # sorted raw scores of the eligible training transactions
    feature_medians: np.ndarray  # typical value of each model feature, in MODEL_FEATURES order
    tz_offset_hours: int
    random_state: int

    def raw_matrix(self, matrix: np.ndarray) -> np.ndarray:
        """Higher means more anomalous."""
        return -self.forest.score_samples(matrix)

    def raw_scores(self, features: pd.DataFrame) -> np.ndarray:
        return self.raw_matrix(features[MODEL_FEATURES].to_numpy())

    def risk(self, raw: np.ndarray) -> np.ndarray:
        """Share of eligible training transactions that scored lower than each value, in [0, 1]."""
        return np.searchsorted(self.train_scores, raw, side="left") / len(self.train_scores)


def fit_anomaly_model(ledger: pd.DataFrame, tz_offset_hours: int = 6, random_state: int = 0) -> AnomalyModel:
    if ledger.empty:
        raise ValueError("Cannot train an anomaly model on an empty ledger")

    stats = fit_reference_stats(ledger)
    features = compute_features(ledger, stats, tz_offset_hours)
    train = features[features["eligible"]]

    if train.empty:
        raise ValueError("The ledger has no eligible transactions to train on")

    matrix = train[MODEL_FEATURES].to_numpy()
    forest = IsolationForest(random_state=random_state, **FOREST_PARAMS).fit(matrix)

    return AnomalyModel(
        stats=stats,
        forest=forest,
        train_scores=np.sort(-forest.score_samples(matrix)),
        feature_medians=train[MODEL_FEATURES].median().to_numpy(),
        tz_offset_hours=tz_offset_hours,
        random_state=random_state,
    )


# ---- the review queue -----------------------------------------------------------------------------------


def period_key(created_at: pd.Series, period: str, tz_offset_hours: int) -> pd.Series:
    """The local week (Sunday to Saturday, matching the Fri/Sat weekend) or local day of each transaction."""
    if period not in PERIODS:
        raise ValueError(f"period must be one of {PERIODS}")

    local = created_at + pd.Timedelta(hours=tz_offset_hours)

    if period == "day":
        return local.dt.strftime("%Y-%m-%d")

    weeks = local.dt.to_period("W-SAT")

    return weeks.dt.start_time.dt.strftime("%Y-%m-%d") + "/" + weeks.dt.end_time.dt.strftime("%Y-%m-%d")


def assign_queue(scored: pd.DataFrame, top_n: int = QUEUE_SIZE, period: str = QUEUE_PERIOD, tz_offset_hours: int = 6) -> pd.DataFrame:
    """Adds `period`, `queue_rank` (1 = riskiest of its period, eligible rows only) and `in_queue`."""
    out = scored.copy()
    out["period"] = period_key(out["created_at"], period, tz_offset_hours)
    ordered = out[out["eligible"]].sort_values(["risk_score", "created_at", "id"], ascending=[False, True, True], kind="stable")
    out["queue_rank"] = ordered.groupby("period").cumcount().add(1).reindex(out.index)
    out["in_queue"] = out["queue_rank"].notna() & (out["queue_rank"] <= top_n)

    return out


def top_contributions(model: AnomalyModel, features: pd.DataFrame, k: int = TOP_FEATURES) -> list[list[dict]]:
    """For each row, the features that raise its anomaly score most.

    Model-agnostic ablation: set one feature at a time to its typical value and see
    how far the score falls. A feature that cannot isolate anything (for example one
    that is constant in most trees) honestly shows a contribution near zero.
    """
    if features.empty:
        return []

    matrix = features[MODEL_FEATURES].to_numpy()
    base = model.raw_matrix(matrix)
    drops = np.zeros_like(matrix)

    for j in range(matrix.shape[1]):
        neutral = matrix.copy()
        neutral[:, j] = model.feature_medians[j]
        drops[:, j] = base - model.raw_matrix(neutral)

    result = []

    for i in range(len(features)):
        picked = []

        for j in np.argsort(-drops[i], kind="stable")[:k]:
            if drops[i, j] < MIN_CONTRIBUTION:
                break

            label, column, to_units = feature_label(MODEL_FEATURES[j])
            row = features.iloc[i]
            value, typical = float(row[column]), float(to_units(model.feature_medians[j]))
            picked.append(
                {
                    "feature": label,
                    "text": describe_feature(MODEL_FEATURES[j], value, typical),
                    "value": value,
                    "typical": typical,
                    "contribution": float(drops[i, j]),
                }
            )

        result.append(picked)

    return result


def explain(row: pd.Series) -> str:
    """Why a transaction looks unusual, in plain language."""
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


# ---- assembling flags -----------------------------------------------------------------------------------


def score_rows(model: AnomalyModel, ledger: pd.DataFrame) -> pd.DataFrame:
    """Features, risk score and rule hits for every transaction in `ledger`.

    `ledger` must contain the earlier movements of each series (gaps and repeats look back).
    The queue is NOT assigned here: it ranks a chosen set of transactions, see `add_queue`.
    """
    features = compute_features(ledger, model.stats, model.tz_offset_hours)
    features["risk_score"] = model.risk(model.raw_scores(features))
    rules = apply_rules(features)

    out = features.merge(rules, on="id", how="left")
    out["rule_flag"] = out["rule_codes"].notna()

    return out


def add_queue(scored: pd.DataFrame, model: AnomalyModel, top_n: int = QUEUE_SIZE, period: str = QUEUE_PERIOD) -> pd.DataFrame:
    """Ranks `scored` per period and builds the final flags: a row is flagged by a rule or by being in the queue."""
    out = assign_queue(scored, top_n, period, model.tz_offset_hours)
    out["model_flag"] = out["in_queue"]
    out["flagged"] = out["rule_flag"] | out["model_flag"]
    out["source"] = np.select(
        [out["rule_flag"] & out["model_flag"], out["rule_flag"], out["model_flag"]], [BOTH, RULE, MODEL], default=""
    )
    out["score"] = np.where(out["rule_flag"], np.maximum(out["rule_score"].fillna(0.0), out["risk_score"]), out["risk_score"])

    contributions = {}
    queued = out[out["in_queue"]]

    for row_id, picked in zip(queued["id"], top_contributions(model, queued)):
        contributions[row_id] = picked

    out["top_features"] = out["id"].map(lambda row_id: contributions.get(row_id, []))

    reasons = []

    for _, row in out.iterrows():
        text = []

        if row["rule_flag"]:
            text.append(row["rule_reason"])

        if row["in_queue"] and not row["rule_flag"]:
            text.append(f"Risk {row['risk_score']:.3f}, rank {int(row['queue_rank'])} in the review queue of {row['period']}. {explain(row)}")

        reasons.append(" | ".join(text) if text else None)

    out["reason"] = pd.Series(reasons, index=out.index, dtype=object)  # None, not NaN, when nothing fired

    return out.sort_values(["created_at", "id"], kind="stable").reset_index(drop=True)


def score_ledger(model: AnomalyModel, ledger: pd.DataFrame, top_n: int = QUEUE_SIZE, period: str = QUEUE_PERIOD) -> pd.DataFrame:
    """Score every transaction in `ledger` and build the queue over all of them."""
    return add_queue(score_rows(model, ledger), model, top_n, period)
