import json
import re

import numpy as np
import pandas as pd
import pytest

from app.anomaly.features import MODEL_FEATURES, compute_features
from app.anomaly.model import (
    BOTH,
    MODEL,
    RULE,
    add_queue,
    assign_queue,
    explain,
    fit_anomaly_model,
    period_key,
    score_ledger,
    score_rows,
    top_contributions,
)
from app.anomaly.training import KIND, train_anomaly
from app.registry import ModelRegistry
from app.versioning import to_jsonable


def normal_ledger(seed=0, series=6, days=60):
    """Business-hours issues of 1-4 units with periodic document-linked receipts, balances consistent."""
    rng = np.random.default_rng(seed)
    rows, next_id = [], 1

    for product in range(1, series + 1):
        balance = 0
        for day in pd.date_range("2026-08-03", periods=days):
            if day.day_of_week % 7 == 0 or balance < 20:
                balance += 60
                rows.append((next_id, product, 1, "RECEIPT", 60, balance, product, day + pd.Timedelta(hours=3)))
                next_id += 1
            for _ in range(rng.integers(0, 3)):
                quantity = int(rng.integers(1, 5))
                if balance >= quantity:
                    balance -= quantity
                    minute = int(rng.integers(0, 9 * 60))
                    rows.append((next_id, product, 1, "ISSUE", -quantity, balance, None, day + pd.Timedelta(hours=2, minutes=minute)))
                    next_id += 1

    frame = pd.DataFrame(rows, columns=["id", "product_id", "warehouse_id", "type", "quantity", "balance_after", "reference_id", "created_at"])

    return frame.sort_values(["created_at", "id"]).reset_index(drop=True)


def with_outlier(ledger):
    """One enormous issue at 21:00 UTC (03:00 local) of product 1."""
    last = ledger[ledger["product_id"] == 1].iloc[-1]
    row = {
        "id": int(ledger["id"].max()) + 1, "product_id": 1, "warehouse_id": 1, "type": "ISSUE", "quantity": -45,
        "balance_after": max(int(last["balance_after"]) - 45, 0), "reference_id": None, "created_at": pd.Timestamp("2026-10-01 21:00"),
    }

    return pd.concat([ledger, pd.DataFrame([row])], ignore_index=True).sort_values(["created_at", "id"]).reset_index(drop=True), row["id"]


@pytest.fixture(scope="module")
def trained():
    ledger, outlier_id = with_outlier(normal_ledger())

    return ledger, outlier_id, fit_anomaly_model(ledger)


# ---- the risk score -------------------------------------------------------------------------------------------


def test_an_obvious_outlier_is_the_riskiest_transaction_and_tops_its_weeks_queue(trained):
    ledger, outlier_id, model = trained

    scored = score_ledger(model, ledger).set_index("id")
    row = scored.loc[outlier_id]

    assert row["risk_score"] == scored.loc[scored["eligible"], "risk_score"].max() >= 0.99
    assert row["queue_rank"] == 1 and row["in_queue"] and row["source"] == BOTH
    assert "R2" in row["rule_codes"] and "R3" in row["rule_codes"]


def test_risk_is_in_unit_range_and_ordered_like_the_raw_scores(trained):
    ledger, _, model = trained
    features = compute_features(ledger, model.stats, 6)
    raw = model.raw_scores(features)
    risk = model.risk(raw)

    assert risk.min() >= 0.0 and risk.max() <= 1.0
    assert (np.diff(risk[np.argsort(raw, kind="stable")]) >= 0).all()


def test_the_forest_is_trained_on_eligible_transactions_only(trained):
    ledger, _, model = trained
    features = compute_features(ledger, model.stats, 6)

    assert len(model.train_scores) == int(features["eligible"].sum()) < len(features)
    assert (np.diff(model.train_scores) >= 0).all()  # kept sorted for the percentile lookup
    assert len(model.feature_medians) == len(MODEL_FEATURES)


def test_the_model_is_deterministic():
    ledger, _ = with_outlier(normal_ledger(seed=3))
    a, b = fit_anomaly_model(ledger, random_state=0), fit_anomaly_model(ledger, random_state=0)
    features = compute_features(ledger, a.stats, 6)

    assert np.array_equal(a.raw_scores(features), b.raw_scores(features))
    assert np.array_equal(a.train_scores, b.train_scores) and np.array_equal(a.feature_medians, b.feature_medians)


def test_scoring_one_series_gives_the_same_risk_as_scoring_the_whole_ledger(trained):
    ledger, _, model = trained
    whole = score_rows(model, ledger).set_index("id")
    part = score_rows(model, ledger[ledger["product_id"] == 1]).set_index("id")

    pd.testing.assert_series_equal(part["risk_score"], whole.loc[part.index, "risk_score"])


def test_a_ledger_with_nothing_to_learn_from_is_refused():
    with pytest.raises(ValueError, match="empty"):
        fit_anomaly_model(normal_ledger().iloc[0:0])

    only_receipts = normal_ledger()
    only_receipts = only_receipts[only_receipts["type"] == "RECEIPT"]
    with pytest.raises(ValueError, match="no eligible"):
        fit_anomaly_model(only_receipts)


# ---- periods ----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "utc, week",
    [
        ("2026-10-03 17:59", "2026-09-27/2026-10-03"),  # 23:59 local Saturday: still that Sunday-Saturday week
        ("2026-10-03 18:00", "2026-10-04/2026-10-10"),  # 00:00 local Sunday starts the next week
        ("2026-10-04 04:00", "2026-10-04/2026-10-10"),
        ("2026-10-10 17:59", "2026-10-04/2026-10-10"),
        ("2026-10-10 18:00", "2026-10-11/2026-10-17"),
    ],
)
def test_weeks_run_sunday_to_saturday_in_local_time(utc, week):
    assert period_key(pd.Series(pd.to_datetime([utc])), "week", 6).iloc[0] == week


def test_days_are_local_days_and_unknown_periods_are_rejected():
    stamps = pd.Series(pd.to_datetime(["2026-10-01 17:59", "2026-10-01 18:00"]))

    assert list(period_key(stamps, "day", 6)) == ["2026-10-01", "2026-10-02"]
    with pytest.raises(ValueError, match="period"):
        period_key(stamps, "month", 6)


# ---- the review queue --------------------------------------------------------------------------------------------------


def synthetic_scored(risks, eligible=None, times=None, ids=None):
    n = len(risks)

    return pd.DataFrame(
        {
            "id": ids or list(range(1, n + 1)),
            "risk_score": risks,
            "eligible": eligible or [True] * n,
            "created_at": pd.to_datetime(times or ["2026-10-05 04:00"] * n),
            "rule_flag": [False] * n,
        }
    )


def test_the_queue_holds_the_top_n_of_each_period_ranked_by_risk():
    scored = synthetic_scored(
        [0.2, 0.9, 0.5, 0.7, 0.99, 0.1],
        times=["2026-10-05 04:00"] * 3 + ["2026-10-12 04:00"] * 3,  # two different weeks
    )

    out = assign_queue(scored, top_n=2, tz_offset_hours=6).set_index("id")

    assert out["queue_rank"].tolist() == [3, 1, 2, 2, 1, 3]
    assert out["in_queue"].tolist() == [False, True, True, True, True, False]
    assert out["period"].nunique() == 2


def test_ties_are_broken_by_time_then_id_so_the_queue_is_stable():
    scored = synthetic_scored([0.5, 0.5, 0.5, 0.5], times=["2026-10-05 06:00", "2026-10-05 04:00", "2026-10-05 04:00", "2026-10-05 05:00"], ids=[10, 20, 30, 40])

    out = assign_queue(scored, top_n=2, tz_offset_hours=6).set_index("id")

    assert out["queue_rank"].to_dict() == {20: 1, 30: 2, 40: 3, 10: 4}  # earliest first; equal times by id
    assert (assign_queue(scored.sample(frac=1, random_state=1), 2, "week", 6).set_index("id")["queue_rank"].to_dict() == out["queue_rank"].to_dict())


def test_ineligible_transactions_never_enter_the_queue_however_risky():
    scored = synthetic_scored([0.99, 0.5, 0.4], eligible=[False, True, True])

    out = assign_queue(scored, top_n=2, tz_offset_hours=6).set_index("id")

    assert out["queue_rank"].isna().tolist() == [True, False, False]
    assert out["in_queue"].tolist() == [False, True, True] and out.loc[2, "queue_rank"] == 1


def test_a_smaller_period_than_n_queues_everything_and_zero_turns_the_queue_off():
    scored = synthetic_scored([0.3, 0.6])

    assert assign_queue(scored, 10, "week", 6)["in_queue"].all()
    assert not assign_queue(scored, 0, "week", 6)["in_queue"].any()


def test_the_queue_only_ranks_the_rows_it_is_given(trained):
    ledger, outlier_id, model = trained
    rows = score_rows(model, ledger)
    subset = rows[(rows["product_id"] == 2) & rows["eligible"]]

    queue = add_queue(subset, model, top_n=3, period="week")

    assert outlier_id not in set(queue["id"])  # it belongs to product 1
    assert queue.groupby("period")["in_queue"].sum().max() <= 3


def test_about_n_per_week_are_queued_and_the_rules_flag_independently(trained):
    ledger, _, model = trained
    scored = score_ledger(model, ledger, top_n=3)

    assert scored.groupby("period")["in_queue"].sum().max() <= 3
    assert scored.loc[scored["in_queue"], "eligible"].all()
    assert (scored["flagged"] == (scored["rule_flag"] | scored["in_queue"])).all()
    assert set(scored["source"]) <= {"", RULE, MODEL, BOTH}


# ---- why: the top contributing features ----------------------------------------------------------------------------------------


def test_the_outliers_top_features_name_its_size_with_its_value_and_what_is_typical(trained):
    ledger, outlier_id, model = trained
    features = compute_features(ledger, model.stats, 6)
    row = features[features["id"] == outlier_id]

    picked = top_contributions(model, row)[0]

    by_name = {p["feature"]: p for p in picked}

    assert set(by_name) == {"size as a multiple of the usual", "share of the stock on hand that moved", "hours outside business hours"}
    assert by_name["size as a multiple of the usual"]["value"] == 18.0 and by_name["size as a multiple of the usual"]["typical"] == 1.0
    assert by_name["hours outside business hours"]["value"] == 5.0 and by_name["hours outside business hours"]["typical"] == 0.0
    assert by_name["share of the stock on hand that moved"]["value"] == pytest.approx(45 / 366, abs=0.2)
    assert [p["contribution"] for p in picked] == sorted((p["contribution"] for p in picked), reverse=True)
    assert all(p["contribution"] >= 0.04 for p in picked)  # each one really lifts the score


def test_a_typical_transaction_has_no_notable_contributions(trained):
    ledger, _, model = trained
    features = compute_features(ledger, model.stats, 6)
    scored = model.risk(model.raw_scores(features))
    typical = features.iloc[[int(np.argmin(np.abs(scored - 0.5)))]]

    assert all(p["contribution"] < 0.05 for p in top_contributions(model, typical)[0])


def test_contributions_are_deterministic_and_empty_input_is_fine(trained):
    ledger, _, model = trained
    features = compute_features(ledger, model.stats, 6).head(20)

    assert top_contributions(model, features) == top_contributions(model, features)
    assert top_contributions(model, features.iloc[0:0]) == []


def test_only_queued_rows_carry_top_features(trained):
    ledger, _, model = trained
    scored = score_ledger(model, ledger, top_n=2)

    assert scored.loc[scored["in_queue"], "top_features"].map(len).gt(0).any()
    assert scored.loc[~scored["in_queue"], "top_features"].map(len).eq(0).all()


# ---- reasons --------------------------------------------------------------------------------------------------------------------------------


def test_a_queue_only_row_explains_its_rank_and_a_rule_row_uses_the_rule_text(trained):
    ledger, outlier_id, model = trained
    scored = score_ledger(model, ledger, top_n=2).set_index("id")

    only_queue = scored[(scored["source"] == MODEL)].iloc[0]
    rule_row = scored.loc[outlier_id]

    assert re.match(r"Risk 0\.\d{3}, rank [12] in the review queue of \d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}\. Statistically unusual:", only_queue["reason"])
    assert "Issue of 45 units" in rule_row["reason"] and "Risk" not in rule_row["reason"]
    assert scored[~scored["flagged"]]["reason"].isna().all()


def test_explanations_name_the_reasons_in_plain_language():
    base = {
        "robust_z": 0.0, "abs_qty": 3.0, "ref_median": 2.0, "off_hours_distance": 0.0,
        "repeat_within_10min": 0.0, "share_of_stock": 0.1, "manual_receipt_no_ref": 0.0, "ratio_to_median": 1.5,
    }

    assert "an unusual combination" in explain(pd.Series(base))
    assert "9 units is 4.5x the usual 2" in explain(pd.Series({**base, "robust_z": 7.0, "abs_qty": 9.0}))
    assert "outside business hours" in explain(pd.Series({**base, "off_hours_distance": 2.0}))
    assert "repeats an identical movement within 10 minutes" in explain(pd.Series({**base, "repeat_within_10min": 1.0}))
    assert "moves 60% of the stock on hand" in explain(pd.Series({**base, "share_of_stock": 0.6}))
    assert "manual receipt without a document" in explain(pd.Series({**base, "manual_receipt_no_ref": 1.0, "ratio_to_median": 6.0}))


# ---- registry ------------------------------------------------------------------------------------------------------------------------------------


def test_training_registers_a_model_that_scores_identically_after_loading(tmp_path):
    ledger, _ = with_outlier(normal_ledger())
    registry = ModelRegistry(tmp_path)

    outcome = train_anomaly(ledger, registry)

    # the outlier is at 21:00 UTC = 03:00 local on the next day, so the as-of day is 2026-10-02
    assert re.fullmatch(r"anomaly-20261002-[0-9a-f]{8}", outcome.version)
    assert registry.active_version(KIND) == outcome.version
    loaded, metrics, metadata = registry.load(KIND)
    pd.testing.assert_series_equal(score_ledger(loaded, ledger)["risk_score"], outcome.scored["risk_score"])
    assert metrics["transactions"] == len(ledger) and metrics["eligible_transactions"] < len(ledger)
    assert metrics["in_review_queue"] > 0 and metrics["queue"] == {"size": 10, "period": "week"}
    assert metrics["flagged"] == metrics["flagged_by_rule"] + metrics["in_review_queue"] - metrics["flagged_by_both"]
    json.dumps(to_jsonable(metrics), allow_nan=False)
    assert metadata["config"]["rules"]["R5"] == {"window_minutes": 10}
    assert "document-linked receipts" in metadata["config"]["training_population"]


def test_same_data_same_version_and_a_changed_row_a_new_one(tmp_path):
    ledger, _ = with_outlier(normal_ledger())
    changed = ledger.copy()
    changed.loc[changed.index[10], "quantity"] -= 1

    a = train_anomaly(ledger, ModelRegistry(tmp_path / "a")).version
    b = train_anomaly(ledger, ModelRegistry(tmp_path / "b")).version
    c = train_anomaly(changed, ModelRegistry(tmp_path / "c")).version

    assert a == b and a != c


def test_metrics_state_that_labels_play_no_part_in_training(tmp_path):
    outcome = train_anomaly(normal_ledger(), ModelRegistry(tmp_path))

    assert "Labels are never used" in outcome.metrics["note"]
    assert not any("label" in column.lower() for column in outcome.scored.columns)


# ---- plain-language wording of the top contributing features --------------------------------------------------

from app.anomaly.model import MODEL_FEATURES, describe_feature  # noqa: E402


@pytest.mark.parametrize(
    "name, value, typical, expected",
    [
        ("log_abs_qty", 10, 1, "It moved 10 units; a typical movement is about 1."),
        ("log_abs_qty", 1, 1, "It moved 1 unit; a typical movement is about 1."),
        ("ratio_to_median", 10, 1, "Its size is 10.0 times the usual size for this product."),
        ("ratio_to_median", 0.3, 1, "Its size is only 30% of the usual size for this product."),
        ("robust_z", 9.0, 0, "Its size is unusually large for this product: 9.0 steps above normal (3 or more counts as unusual)."),
        ("robust_z", -4.2, 0, "Its size is unusually small for this product: 4.2 steps below normal (3 or more counts as unusual)."),
        ("robust_z", 1.8, 0, "Its size is somewhat large for this product: 1.8 steps above normal (3 or more counts as unusual)."),
        ("robust_z", -1.3, 0, "Its size is somewhat small for this product: 1.3 steps below normal (3 or more counts as unusual)."),
        ("robust_z", 0.4, 0, "Its size is close to the usual for this product (0.4 steps from normal)."),
        ("share_of_stock", 0.56, 0, "It moved 56% of the stock on hand."),
        ("share_of_stock", 0.30, 0.05, "It moved 30% of the stock on hand (typically 5%)."),
        ("off_hours_distance", 5, 0, "It happened 5.0 hours outside business hours (08:00 to 17:00); most movements happen inside them."),
        ("off_hours_distance", 1, 0, "It happened 1.0 hour outside business hours (08:00 to 17:00); most movements happen inside them."),
        ("is_weekend", 1, 0, "It happened on a weekend day (Friday or Saturday); most movements do not."),
        ("log_gap_prev_min", 3, 1069, "It came 3 minutes after the previous movement of this product here (typically 17.8 hours)."),
        ("log_gap_prev_min", 1, 60, "It came 1 minute after the previous movement of this product here (typically 60 minutes)."),
        ("log_gap_prev_min", 100000, 1069, "It is the first movement of this product in this warehouse."),
        ("log_gap_prev_min", 4000, 90, "It came 2.8 days after the previous movement of this product here (typically 1.5 hours)."),
        ("repeat_within_10min", 1, 0, "It repeats the movement just before it (same product, warehouse, type and quantity) within 10 minutes, which can be a double entry."),
        ("manual_receipt_no_ref", 1, 0, "It is a manual receipt with no purchase order or goods receipt behind it."),
        ("type_ADJUSTMENT", 1, 0, "It is an adjustment, an uncommon kind of movement for this product."),
        ("type_ISSUE", 0, 1, "It is not an issue, the most common kind of movement."),
    ],
)
def test_each_feature_reads_as_a_plain_sentence_that_keeps_its_numbers(name, value, typical, expected):
    assert describe_feature(name, value, typical) == expected


def test_every_model_feature_has_a_sentence_without_jargon_or_internal_names():
    jargon = ("robust z", "log_", "log(", "expm1", "z-score", "ratio_to_median", "(typical 0.0)", "type_", "nan", "inf")

    for name in MODEL_FEATURES:
        for value, typical in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (7.5, 2.0), (-2.0, 0.0)]:
            text = describe_feature(name, value, typical)

            assert text[0].isupper() and text.endswith("."), (name, text)
            assert not any(word in text.lower() for word in jargon), (name, text)
            assert "  " not in text and "{" not in text, (name, text)


def test_the_outliers_top_features_carry_a_sentence_next_to_the_unchanged_numbers(trained):
    ledger, outlier_id, model = trained
    row = compute_features(ledger, model.stats, 6).query("id == @outlier_id")

    picked = {p["feature"]: p for p in top_contributions(model, row)[0]}

    assert set(picked) == {"size as a multiple of the usual", "share of the stock on hand that moved", "hours outside business hours"}
    assert picked["size as a multiple of the usual"]["text"] == "Its size is 18.0 times the usual size for this product."
    assert picked["hours outside business hours"]["text"] == "It happened 5.0 hours outside business hours (08:00 to 17:00); most movements happen inside them."
    assert picked["share of the stock on hand that moved"]["text"].startswith("It moved ") and "% of the stock on hand" in picked["share of the stock on hand that moved"]["text"]

    for feature in picked.values():  # the numbers themselves are unchanged
        assert set(feature) == {"feature", "text", "value", "typical", "contribution"}

    assert picked["size as a multiple of the usual"]["value"] == 18.0 and picked["size as a multiple of the usual"]["typical"] == 1.0
