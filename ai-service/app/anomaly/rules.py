"""Transparent rules (AI-008). Defined up front and never tuned on the labels.

R1  large negative adjustment      ADJUSTMENT, at least 5 units and 20% of the stock before it
R2  quantity far above normal      ISSUE, robust z above 6 and at least 5 units
R3  outside business hours         any stock movement outside 08:00-17:00 local time
R4  large manual receipt           RECEIPT without a document, at least 10 units and 5x the
                                   product's typical issue size
R5  duplicate movement             the same product, warehouse, type and quantity as the movement
                                   before it, within 10 minutes (REPEAT_WINDOW_MIN)

Each rule gives a human-readable reason. R5 was added in the second pass; its window
(10 minutes: a retried request or a double entry, not a second real order) was fixed
before the pass looked at any result, and it ignores documented receipts and
movements that do not change stock. R1 and R2 were NOT changed in that pass: their
false positives are ordinary events that no data field tells apart from anomalies.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.anomaly.features import AFFECTS_ON_HAND, BUSINESS_END_MIN, BUSINESS_START_MIN, REPEAT_WINDOW_MIN

R1_MIN_UNITS = 5
R1_MIN_SHARE = 0.20
R2_MIN_Z = 6.0
R2_MIN_UNITS = 5
R4_MIN_UNITS = 10
R4_MIN_MULTIPLE = 5.0

SEVERITY = {"R1": 0.9, "R2": 0.9, "R3": 0.7, "R4": 0.7, "R5": 0.6}


@dataclass(frozen=True)
class RuleHit:
    code: str
    reason: str
    severity: float


def _clock(local_minute: int) -> str:
    return f"{local_minute // 60:02d}:{local_minute % 60:02d}"


def rule_hits(row: pd.Series) -> list[RuleHit]:
    """All rules that fire for one feature row."""
    hits = []
    kind, qty = row["type"], row["quantity"]

    if kind == "ADJUSTMENT" and qty < 0 and row["abs_qty"] >= R1_MIN_UNITS and row["share_of_stock"] >= R1_MIN_SHARE:
        hits.append(
            RuleHit(
                "R1",
                f"Negative adjustment of {int(row['abs_qty'])} units, {row['share_of_stock']:.0%} of the "
                f"{int(row['balance_before'])} units on hand",
                SEVERITY["R1"],
            )
        )

    if kind == "ISSUE" and row["robust_z"] > R2_MIN_Z and row["abs_qty"] >= R2_MIN_UNITS:
        hits.append(
            RuleHit(
                "R2",
                f"Issue of {int(row['abs_qty'])} units is {row['abs_qty'] / max(row['ref_median'], 1):.1f}x the usual "
                f"{row['ref_median']:g} for this product (robust z {row['robust_z']:.1f})",
                SEVERITY["R2"],
            )
        )

    outside = not (BUSINESS_START_MIN <= row["local_minute"] < BUSINESS_END_MIN)

    if outside and kind in AFFECTS_ON_HAND:
        hits.append(
            RuleHit(
                "R3",
                f"{kind.replace('_', ' ').title()} at {_clock(int(row['local_minute']))} local time, outside "
                f"business hours ({_clock(BUSINESS_START_MIN)}-{_clock(BUSINESS_END_MIN)})",
                SEVERITY["R3"],
            )
        )

    if (
        kind == "RECEIPT"
        and row["manual_receipt_no_ref"] == 1.0
        and row["abs_qty"] >= R4_MIN_UNITS
        and row["abs_qty"] >= R4_MIN_MULTIPLE * max(row["issue_median"], 1.0)
    ):
        hits.append(
            RuleHit(
                "R4",
                f"Manual receipt of {int(row['abs_qty'])} units with no purchase order or goods receipt "
                f"(typical issue is {row['issue_median']:g})",
                SEVERITY["R4"],
            )
        )

    if row["repeat_within_10min"] == 1.0 and row["eligible"] and row["abs_qty"] > 0:
        hits.append(
            RuleHit(
                "R5",
                f"Identical {kind.replace('_', ' ').lower()} of {int(row['abs_qty'])} units, "
                f"{row['repeat_gap_min']:.0f} minutes after the previous one (window {REPEAT_WINDOW_MIN} minutes)",
                SEVERITY["R5"],
            )
        )

    return hits


def apply_rules(features: pd.DataFrame) -> pd.DataFrame:
    """Frame [id, rule_codes, rule_reason, rule_score] for the rows where at least one rule fired."""
    rows = []

    for _, row in features.iterrows():
        hits = rule_hits(row)

        if hits:
            rows.append(
                {
                    "id": row["id"],
                    "rule_codes": [hit.code for hit in hits],
                    "rule_reason": "; ".join(hit.reason for hit in hits),
                    "rule_score": max(hit.severity for hit in hits),
                }
            )

    return pd.DataFrame(rows, columns=["id", "rule_codes", "rule_reason", "rule_score"])
