"""Per-transaction features for anomaly detection (AI-008).

Everything is computed from the ledger columns the read-only role may see. Size
is judged against what is normal FOR THAT PRODUCT AND MOVEMENT TYPE (robust
median / MAD learnt at training time), timing against the business hours
(08:00-17:00 local, UTC+6 by default), and repeats / bursts against the previous
movements of the same product and warehouse.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

TYPES = ["ISSUE", "RECEIPT", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "RESERVATION", "RELEASE"]
AFFECTS_ON_HAND = {"RECEIPT", "ISSUE", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"}

BUSINESS_START_MIN = 8 * 60  # 08:00 local
BUSINESS_END_MIN = 17 * 60  # 17:00 local (exclusive)
WEEKEND_DAYS = (4, 5)  # Friday and Saturday
REPEAT_WINDOW_MIN = 10
NO_PREVIOUS_MIN = 100_000.0  # "nothing before it" for the first movement of a series

SERIES = ["product_id", "warehouse_id"]

MODEL_FEATURES = [
    "log_abs_qty",
    "robust_z",
    "ratio_to_median",
    "share_of_stock",
    "off_hours_distance",
    "is_weekend",
    "log_gap_prev_min",
    "repeat_within_10min",
    "manual_receipt_no_ref",
    *[f"type_{name}" for name in TYPES],
]


@dataclass
class ReferenceStats:
    """Robust size statistics learnt from the training ledger."""

    by_series_type: pd.DataFrame  # product_id, warehouse_id, type, median, scale, n
    by_type: pd.DataFrame  # type, median, scale (fallback for unseen series)

    def issue_median(self) -> pd.DataFrame:
        return self.by_series_type[self.by_series_type["type"] == "ISSUE"][SERIES + ["median"]].rename(
            columns={"median": "issue_median"}
        )


def _robust(abs_qty: pd.Series) -> tuple[float, float]:
    median = float(abs_qty.median())
    mad = float((abs_qty - median).abs().median())

    return median, max(1.4826 * mad, 1.0)  # a scale below one unit would make every unit "unusual"


def fit_reference_stats(ledger: pd.DataFrame) -> ReferenceStats:
    frame = ledger.assign(abs_qty=ledger["quantity"].abs())
    rows = []

    for (product_id, warehouse_id, kind), group in frame.groupby(SERIES + ["type"]):
        median, scale = _robust(group["abs_qty"])
        rows.append((product_id, warehouse_id, kind, median, scale, len(group)))

    by_series_type = pd.DataFrame(rows, columns=SERIES + ["type", "median", "scale", "n"])
    by_type = pd.DataFrame(
        [(kind, *_robust(group["abs_qty"])) for kind, group in frame.groupby("type")],
        columns=["type", "median", "scale"],
    )

    return ReferenceStats(by_series_type=by_series_type, by_type=by_type)


MIN_REFERENCE_ROWS = 5  # fewer observations than this and the pooled type statistics are used


def compute_features(ledger: pd.DataFrame, stats: ReferenceStats, tz_offset_hours: int = 6) -> pd.DataFrame:
    """One row per ledger row (same `id`), model features plus the columns the rules need.

    `ledger` must contain the previous movements of every series it covers, since
    the gap and repeat features look backwards.
    """
    df = ledger.sort_values(SERIES + ["created_at", "id"], kind="stable").reset_index(drop=True)

    effect = df["quantity"].where(df["type"].isin(AFFECTS_ON_HAND), 0)
    df["balance_before"] = df["balance_after"] - effect
    df["abs_qty"] = df["quantity"].abs().astype("float64")

    reference = df[SERIES + ["type"]].merge(stats.by_series_type, on=SERIES + ["type"], how="left")
    pooled = df[["type"]].merge(stats.by_type, on="type", how="left")
    known = reference["n"].fillna(0).to_numpy() >= MIN_REFERENCE_ROWS
    median = np.where(known, reference["median"].to_numpy(), pooled["median"].to_numpy())
    scale = np.where(known, reference["scale"].to_numpy(), pooled["scale"].to_numpy())
    median = np.nan_to_num(median, nan=0.0)
    scale = np.nan_to_num(scale, nan=1.0)

    df["ref_median"] = median
    df["robust_z"] = (df["abs_qty"] - median) / scale
    df["ratio_to_median"] = df["abs_qty"] / np.maximum(median, 1.0)
    df["share_of_stock"] = (df["abs_qty"] / df["balance_before"].clip(lower=1)).clip(upper=5.0)
    df = df.merge(stats.issue_median(), on=SERIES, how="left")
    df["issue_median"] = df["issue_median"].fillna(1.0)

    local = df["created_at"] + pd.Timedelta(hours=tz_offset_hours)
    minute_of_day = local.dt.hour * 60 + local.dt.minute
    inside = (minute_of_day >= BUSINESS_START_MIN) & (minute_of_day < BUSINESS_END_MIN)
    after_close = (minute_of_day - BUSINESS_END_MIN) % 1440
    before_open = (BUSINESS_START_MIN - minute_of_day) % 1440
    df["local_minute"] = minute_of_day
    df["off_hours_distance"] = np.where(inside, 0.0, np.minimum(after_close, before_open) / 60.0)
    df["is_weekend"] = local.dt.day_of_week.isin(WEEKEND_DAYS).astype("float64")

    gap = df.groupby(SERIES)["created_at"].diff().dt.total_seconds() / 60.0
    df["gap_prev_min"] = gap.fillna(NO_PREVIOUS_MIN)
    df["log_gap_prev_min"] = np.log1p(df["gap_prev_min"])

    same = df.groupby(SERIES + ["type", "quantity"])["created_at"].diff().dt.total_seconds() / 60.0
    df["repeat_within_10min"] = (same.notna() & (same <= REPEAT_WINDOW_MIN)).astype("float64")

    df["manual_receipt_no_ref"] = ((df["type"] == "RECEIPT") & df["reference_id"].isna()).astype("float64")
    df["log_abs_qty"] = np.log1p(df["abs_qty"])

    for name in TYPES:
        df[f"type_{name}"] = (df["type"] == name).astype("float64")

    return df
