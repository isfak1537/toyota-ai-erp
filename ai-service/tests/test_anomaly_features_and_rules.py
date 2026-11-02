import numpy as np
import pandas as pd
import pytest

from app.anomaly.features import (
    MIN_REFERENCE_ROWS,
    MODEL_FEATURES,
    ReferenceStats,
    compute_features,
    fit_reference_stats,
)
from app.anomaly.rules import apply_rules, rule_hits


def ledger(rows):
    frame = pd.DataFrame(
        rows,
        columns=["id", "product_id", "warehouse_id", "type", "quantity", "balance_after", "reference_id", "created_at"],
    )
    frame["created_at"] = pd.to_datetime(frame["created_at"])

    return frame


def stats_for(median=2.0, scale=1.0, issue_median=None):
    """Hand-set reference statistics so the rules can be tested at their boundaries.

    `issue_median` only differs from `median` when a test needs the product's typical
    issue size to be something else than the size used for the z-score."""
    rows = [(1, 1, kind, median, scale, 50) for kind in ("ISSUE", "ADJUSTMENT", "RECEIPT")]
    by_series_type = pd.DataFrame(rows, columns=["product_id", "warehouse_id", "type", "median", "scale", "n"])

    if issue_median is not None:
        by_series_type.loc[by_series_type["type"] == "ISSUE", "median"] = issue_median
    by_type = pd.DataFrame([(k, median, scale) for k in ("ISSUE", "ADJUSTMENT", "RECEIPT")], columns=["type", "median", "scale"])

    return ReferenceStats(by_series_type, by_type)


def feature_row(rows, stats=None, tz=6):
    return compute_features(ledger(rows), stats or stats_for(), tz).iloc[-1]


# ---- statistics ---------------------------------------------------------------------------------


def test_reference_stats_are_robust_to_one_huge_value():
    rows = [(i, 1, 1, "ISSUE", -q, 100, None, f"2026-10-01 0{i % 9}:00") for i, q in enumerate([2, 2, 3, 2, 3, 2, 3, 2, 500], start=1)]

    stats = fit_reference_stats(ledger(rows))
    row = stats.by_series_type.iloc[0]

    # deviations from the median 2 are 0,0,1,0,1,0,1,0,498: their median (the MAD) is 0,
    # so the scale is the one-unit floor; the 500 does not move the median or the scale
    assert row["median"] == 2.0 and row["n"] == 9
    assert row["scale"] == 1.0
    assert stats.by_type.iloc[0]["median"] == 2.0


def test_the_scale_never_drops_below_one_unit():
    rows = [(i, 1, 1, "ISSUE", -2, 100, None, "2026-10-01 04:00") for i in range(1, 9)]

    assert fit_reference_stats(ledger(rows)).by_series_type.iloc[0]["scale"] == 1.0


# ---- features: hand-computed ------------------------------------------------------------------------


def test_balance_before_removes_the_movements_own_effect():
    receipt = feature_row([(1, 1, 1, "RECEIPT", 30, 80, 1, "2026-10-01 04:00")])
    issue = feature_row([(1, 1, 1, "ISSUE", -12, 40, None, "2026-10-01 04:00")])
    reservation = feature_row([(1, 1, 1, "RESERVATION", 0, 40, None, "2026-10-01 04:00")])

    assert receipt["balance_before"] == 50 and issue["balance_before"] == 52 and reservation["balance_before"] == 40
    assert issue["share_of_stock"] == pytest.approx(12 / 52)


def test_the_robust_z_compares_with_the_usual_size_of_that_product_and_movement():
    row = feature_row([(1, 1, 1, "ISSUE", -9, 40, None, "2026-10-01 04:00")], stats_for(median=2.0, scale=1.5))

    assert row["robust_z"] == pytest.approx((9 - 2) / 1.5)
    assert row["ratio_to_median"] == pytest.approx(4.5)


def test_series_with_too_little_history_use_the_pooled_type_statistics():
    thin = ReferenceStats(
        by_series_type=pd.DataFrame([(1, 1, "ISSUE", 100.0, 1.0, MIN_REFERENCE_ROWS - 1)], columns=["product_id", "warehouse_id", "type", "median", "scale", "n"]),
        by_type=pd.DataFrame([("ISSUE", 3.0, 2.0)], columns=["type", "median", "scale"]),
    )

    row = feature_row([(1, 1, 1, "ISSUE", -9, 40, None, "2026-10-01 04:00")], thin)

    assert row["ref_median"] == 3.0 and row["robust_z"] == pytest.approx(3.0)


@pytest.mark.parametrize(
    "utc, distance",
    [
        ("2026-10-04 02:00", 0.0),  # 08:00 local: opening time is inside
        ("2026-10-04 10:59", 0.0),  # 16:59 local
        ("2026-10-04 11:00", 0.0),  # 17:00 local: closed, zero minutes past closing
        ("2026-10-04 11:30", 0.5),  # half an hour after closing
        ("2026-10-04 16:00", 5.0),  # 22:00 local: 5 h after closing (and 10 h before opening)
        ("2026-10-04 21:00", 5.0),  # 03:00 local the next day: 5 h before opening
        ("2026-10-04 01:30", 0.5),  # 07:30 local: half an hour before opening
    ],
)
def test_off_hours_distance_is_the_nearest_distance_to_the_business_window(utc, distance):
    row = feature_row([(1, 1, 1, "ISSUE", -2, 40, None, utc)])

    assert row["off_hours_distance"] == pytest.approx(distance)


def test_friday_and_saturday_are_the_weekend_in_local_time():
    # local = UTC + 6h; 2026-10-09 is a Friday, 18:00 UTC is already Saturday local
    friday = feature_row([(1, 1, 1, "ISSUE", -2, 40, None, "2026-10-09 04:00")])
    saturday_local = feature_row([(1, 1, 1, "ISSUE", -2, 40, None, "2026-10-09 18:30")])
    sunday_local = feature_row([(1, 1, 1, "ISSUE", -2, 40, None, "2026-10-10 18:30")])
    monday = feature_row([(1, 1, 1, "ISSUE", -2, 40, None, "2026-10-12 04:00")])

    assert (friday["is_weekend"], saturday_local["is_weekend"], sunday_local["is_weekend"], monday["is_weekend"]) == (1.0, 1.0, 0.0, 0.0)


def test_repeats_are_identical_movements_of_the_same_series_within_ten_minutes():
    rows = [
        (1, 1, 1, "ISSUE", -4, 96, None, "2026-10-01 04:00:00"),
        (2, 1, 1, "ISSUE", -4, 92, None, "2026-10-01 04:03:00"),  # repeat after 3 minutes
        (3, 1, 1, "ISSUE", -4, 88, None, "2026-10-01 04:13:00"),  # exactly 10 minutes after #2: still a repeat
        (4, 1, 1, "ISSUE", -4, 84, None, "2026-10-01 04:23:01"),  # 10 min 1 s after #3: not a repeat
        (5, 1, 1, "ISSUE", -5, 79, None, "2026-10-01 04:24:00"),  # different quantity
        (6, 2, 1, "ISSUE", -4, 50, None, "2026-10-01 04:24:30"),  # different product
    ]

    flags = compute_features(ledger(rows), stats_for(), 6).set_index("id")["repeat_within_10min"]

    assert flags.to_dict() == {1: 0.0, 2: 1.0, 3: 1.0, 4: 0.0, 5: 0.0, 6: 0.0}


def test_gaps_are_measured_per_series_and_the_first_movement_has_none():
    rows = [
        (1, 1, 1, "RECEIPT", 50, 50, 1, "2026-10-01 03:00"),
        (2, 1, 1, "ISSUE", -2, 48, None, "2026-10-01 05:00"),
        (3, 2, 1, "ISSUE", -2, 10, None, "2026-10-01 05:01"),
    ]

    feats = compute_features(ledger(rows), stats_for(), 6).set_index("id")

    assert feats.loc[2, "gap_prev_min"] == 120.0
    assert feats.loc[1, "gap_prev_min"] == feats.loc[3, "gap_prev_min"] == 100_000.0


def test_manual_receipts_are_those_without_a_document():
    manual = feature_row([(1, 1, 1, "RECEIPT", 30, 80, None, "2026-10-01 04:00")])
    documented = feature_row([(1, 1, 1, "RECEIPT", 30, 80, 7, "2026-10-01 04:00")])
    issue = feature_row([(1, 1, 1, "ISSUE", -30, 80, None, "2026-10-01 04:00")])

    assert (manual["manual_receipt_no_ref"], documented["manual_receipt_no_ref"], issue["manual_receipt_no_ref"]) == (1.0, 0.0, 0.0)


def test_every_model_feature_is_present_numeric_and_finite():
    rows = [(1, 1, 1, "RECEIPT", 50, 50, 1, "2026-10-01 03:00"), (2, 1, 1, "ISSUE", -2, 48, None, "2026-10-01 05:00")]

    feats = compute_features(ledger(rows), stats_for(), 6)

    assert np.isfinite(feats[MODEL_FEATURES].to_numpy()).all()
    assert list(feats[MODEL_FEATURES].dtypes.unique()) == [np.dtype("float64")]


def test_features_for_a_row_do_not_depend_on_later_movements():
    base = [(1, 1, 1, "ISSUE", -4, 96, None, "2026-10-01 04:00"), (2, 1, 1, "ISSUE", -4, 92, None, "2026-10-01 04:03")]
    later = base + [(3, 1, 1, "ISSUE", -400, 0, None, "2026-10-02 04:00")]

    a = compute_features(ledger(base), stats_for(), 6).set_index("id")
    b = compute_features(ledger(later), stats_for(), 6).set_index("id")

    pd.testing.assert_frame_equal(a, b.loc[a.index])


# ---- rules: one positive, one negative and the boundary each ----------------------------------------------------


def hits(rows, stats=None):
    return [hit.code for hit in rule_hits(feature_row(rows, stats))]


@pytest.mark.parametrize(
    "quantity, balance_after, expected",
    [
        (-5, 15, True),  # 5 of 20 = 25%
        (-6, 24, True),  # exactly 20% of 30
        (-5, 25, False),  # 5 of 30 = 16.7%, below 20%
        (-4, 6, False),  # 40% but under 5 units
        (+8, 28, False),  # a positive adjustment is never R1
    ],
)
def test_r1_large_negative_adjustment(quantity, balance_after, expected):
    codes = hits([(1, 1, 1, "ADJUSTMENT", quantity, balance_after, None, "2026-10-01 04:00")])

    assert ("R1" in codes) is expected


@pytest.mark.parametrize(
    "quantity, expected",
    [(-12, True), (-9, True), (-8, False), (-5, False), (+30, False)],
)
def test_r2_quantity_far_above_the_normal_range(quantity, expected):
    # usual size 2, scale 1.0: z = |q| - 2, so z > 6 needs |q| > 8
    kind = "ISSUE" if quantity < 0 else "RECEIPT"
    codes = hits([(1, 1, 1, kind, quantity, 100, 1 if kind == "RECEIPT" else None, "2026-10-01 04:00")])

    assert ("R2" in codes) is expected


def test_r2_needs_both_a_large_z_and_a_real_quantity():
    quiet = stats_for(median=1.0, scale=1.0)  # z = |q| - 1: a 7-unit issue is z 6, an 8 is z 7

    assert "R2" not in hits([(1, 1, 1, "ISSUE", -7, 100, None, "2026-10-01 04:00")], quiet)  # z = 6, not above
    assert "R2" in hits([(1, 1, 1, "ISSUE", -8, 100, None, "2026-10-01 04:00")], quiet)
    tiny_scale = stats_for(median=0.0, scale=0.2)
    assert "R2" not in hits([(1, 1, 1, "ISSUE", -4, 100, None, "2026-10-01 04:00")], tiny_scale)  # z huge, but under 5 units


@pytest.mark.parametrize(
    "utc, kind, expected",
    [
        ("2026-10-01 10:59", "ISSUE", False),  # 16:59 local
        ("2026-10-01 11:00", "ISSUE", True),  # 17:00 local, closing time is outside
        ("2026-10-01 01:59", "ISSUE", True),  # 07:59 local
        ("2026-10-01 02:00", "ISSUE", False),  # 08:00 local, opening time is inside
        ("2026-10-01 21:00", "RECEIPT", True),
        ("2026-10-01 21:00", "ADJUSTMENT", True),
        ("2026-10-01 21:00", "RESERVATION", False),  # not a stock movement
        ("2026-10-01 21:00", "RELEASE", False),
    ],
)
def test_r3_outside_business_hours(utc, kind, expected):
    quantity = 0 if kind in ("RESERVATION", "RELEASE") else (-1 if kind in ("ISSUE", "ADJUSTMENT") else 1)

    assert ("R3" in hits([(1, 1, 1, kind, quantity, 50, 1 if kind == "RECEIPT" else None, utc)])) is expected


@pytest.mark.parametrize(
    "quantity, reference_id, issue_median, expected",
    [
        (18, None, 1.0, True),
        (18, 7, 1.0, False),  # a goods receipt document exists
        (9, None, 1.0, False),  # under 10 units
        (10, None, 1.0, True),  # exactly 10 and 10x the usual issue
        (18, None, 4.0, False),  # 18 < 5 x 4
        (20, None, 4.0, True),  # exactly 5 x 4
    ],
)
def test_r4_large_manual_receipt(quantity, reference_id, issue_median, expected):
    codes = hits(
        [(1, 1, 1, "RECEIPT", quantity, 100, reference_id, "2026-10-01 04:00")], stats_for(issue_median=issue_median)
    )

    assert ("R4" in codes) is expected


def test_rules_explain_themselves_in_plain_language():
    row = feature_row([(1, 1, 1, "ADJUSTMENT", -8, 12, None, "2026-10-01 21:30")])

    reasons = {hit.code: hit.reason for hit in rule_hits(row)}

    assert reasons["R1"] == "Negative adjustment of 8 units, 40% of the 20 units on hand"
    assert reasons["R3"] == "Adjustment at 03:30 local time, outside business hours (08:00-17:00)"


def test_apply_rules_returns_only_flagged_rows_with_combined_reasons_and_the_highest_severity():
    rows = [
        (1, 1, 1, "ISSUE", -2, 98, None, "2026-10-01 04:00"),  # nothing
        (2, 1, 1, "ADJUSTMENT", -8, 12, None, "2026-10-01 21:30"),  # R1 + R3
    ]

    flagged = apply_rules(compute_features(ledger(rows), stats_for(), 6))

    assert list(flagged["id"]) == [2]
    assert flagged.iloc[0]["rule_codes"] == ["R1", "R3"]
    assert flagged.iloc[0]["rule_score"] == 0.9
    assert "; " in flagged.iloc[0]["rule_reason"]
