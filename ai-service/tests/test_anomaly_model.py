import json
import re

import numpy as np
import pandas as pd
import pytest

from app.anomaly.features import MODEL_FEATURES, compute_features
from app.anomaly.model import BOTH, MODEL, RULE, combine_flags, explain, fit_anomaly_model, score_ledger
from app.anomaly.training import KIND, train_anomaly
from app.registry import ModelRegistry
from app.versioning import to_jsonable


def normal_ledger(seed=0, series=6, days=60):
    """Business-hours issues of 1-4 units with periodic goods receipts, balances kept consistent."""
    rng = np.random.default_rng(seed)
    rows, next_id = [], 1

    for product in range(1, series + 1):
        balance = 0
        for day in pd.date_range("2026-08-03", periods=days):
            if day.day_of_week % 7 == 0 or balance < 20:
                quantity = 60
                balance += quantity
                rows.append((next_id, product, 1, "RECEIPT", quantity, balance, product, day + pd.Timedelta(hours=3)))
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
    last = ledger[(ledger["product_id"] == 1)].iloc[-1]
    row = {
        "id": int(ledger["id"].max()) + 1, "product_id": 1, "warehouse_id": 1, "type": "ISSUE", "quantity": -45,
        "balance_after": max(int(last["balance_after"]) - 45, 0), "reference_id": None,
        "created_at": pd.Timestamp("2026-10-01 21:00"),
    }

    return pd.concat([ledger, pd.DataFrame([row])], ignore_index=True).sort_values(["created_at", "id"]).reset_index(drop=True), row["id"]


@pytest.fixture(scope="module")
def trained():
    ledger, outlier_id = with_outlier(normal_ledger())
    model = fit_anomaly_model(ledger)

    return ledger, outlier_id, model


# ---- the forest -----------------------------------------------------------------------------------


def test_an_obvious_outlier_gets_the_top_score_and_is_flagged_by_rule_and_model(trained):
    ledger, outlier_id, model = trained

    scored = score_ledger(model, ledger).set_index("id")
    row = scored.loc[outlier_id]

    assert row["model_score"] == scored["model_score"].max() and row["model_score"] >= 0.995
    assert row["source"] == BOTH and row["flagged"]
    assert "R2" in row["rule_codes"] and "R3" in row["rule_codes"]


def test_scores_are_in_unit_range_and_ordered_like_the_raw_scores(trained):
    ledger, _, model = trained
    features = compute_features(ledger, model.stats, 6)
    raw = model.raw_scores(features)
    unit = model.score01(raw)

    assert unit.min() >= 0.0 and unit.max() <= 1.0
    order = np.argsort(raw, kind="stable")
    assert (np.diff(unit[order]) >= 0).all()


def test_about_half_a_percent_of_the_training_transactions_are_model_flags(trained):
    ledger, _, model = trained
    scored = score_ledger(model, ledger)

    share = scored["model_flag"].mean()

    assert 0.002 <= share <= 0.009  # contamination is 0.5%
    assert model.flag_threshold == pytest.approx(0.995)


def test_ordinary_business_traffic_is_not_flagged_by_the_rules(trained):
    ledger, outlier_id, model = trained
    scored = score_ledger(model, ledger)

    assert scored[scored["id"] != outlier_id]["rule_flag"].sum() == 0


def test_the_model_is_deterministic():
    ledger, _ = with_outlier(normal_ledger(seed=3))

    a = fit_anomaly_model(ledger, random_state=0)
    b = fit_anomaly_model(ledger, random_state=0)
    features = compute_features(ledger, a.stats, 6)

    assert np.array_equal(a.raw_scores(features), b.raw_scores(features))
    assert np.array_equal(a.train_scores, b.train_scores)


def test_scoring_a_series_gives_the_same_result_as_scoring_the_whole_ledger(trained):
    ledger, _, model = trained
    whole = score_ledger(model, ledger).set_index("id")
    one_series = ledger[ledger["product_id"] == 1]

    part = score_ledger(model, one_series).set_index("id")

    pd.testing.assert_series_equal(part["model_score"], whole.loc[part.index, "model_score"])
    assert (part["source"] == whole.loc[part.index, "source"]).all()


def test_an_empty_ledger_is_refused():
    with pytest.raises(ValueError, match="empty"):
        fit_anomaly_model(normal_ledger().iloc[0:0])


# ---- assembling flags -----------------------------------------------------------------------------------------


def features_frame(n=4):
    rows = [(i, 1, 1, "ISSUE", -2, 50, None, pd.Timestamp("2026-10-01 04:00") + pd.Timedelta(minutes=i)) for i in range(1, n + 1)]
    frame = pd.DataFrame(rows, columns=["id", "product_id", "warehouse_id", "type", "quantity", "balance_after", "reference_id", "created_at"])
    stats = fit_anomaly_model(normal_ledger()).stats

    return compute_features(frame, stats, 6)


def test_flags_say_where_they_came_from_and_take_the_stronger_score():
    features = features_frame()
    model_score = np.array([0.10, 0.999, 0.999, 0.20])
    model_flag = np.array([False, True, True, False])
    rules = pd.DataFrame(
        {"id": [3, 4], "rule_codes": [["R3"], ["R1"]], "rule_reason": ["after hours", "big drop"], "rule_score": [0.7, 0.9]}
    )

    out = combine_flags(features, model_score, model_flag, rules).set_index("id")

    assert out.loc[1, "source"] == "" and not out.loc[1, "flagged"] and out.loc[1, "reason"] is None
    assert out.loc[2, "source"] == MODEL and out.loc[2, "reason"].startswith("Model score 0.999.")
    assert out.loc[3, "source"] == BOTH and out.loc[3, "reason"] == "after hours"  # the rule reason is the clearer one
    assert out.loc[4, "source"] == RULE and out.loc[4, "score"] == 0.9
    assert out.loc[3, "score"] == 0.999  # model score above the rule severity


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


# ---- registry ------------------------------------------------------------------------------------------------------------


def test_training_registers_a_model_that_scores_identically_after_loading(tmp_path):
    ledger, _ = with_outlier(normal_ledger())
    registry = ModelRegistry(tmp_path)

    outcome = train_anomaly(ledger, registry)

    # the outlier is at 21:00 UTC = 03:00 local on the next day, so the as-of day is 2026-10-02
    assert re.fullmatch(r"anomaly-20261002-[0-9a-f]{8}", outcome.version)
    assert registry.active_version(KIND) == outcome.version
    loaded, metrics, metadata = registry.load(KIND)
    reloaded = score_ledger(loaded, ledger)
    pd.testing.assert_series_equal(reloaded["model_score"], outcome.scored["model_score"])
    assert metrics["transactions"] == len(ledger) and metrics["flagged"] >= 1
    assert metrics["flagged"] == metrics["flagged_by_rule"] + metrics["flagged_by_model"] - metrics["flagged_by_both"]
    json.dumps(to_jsonable(metrics), allow_nan=False)
    assert metadata["config"]["rules"]["R1"] == {"min_units": 5, "min_share": 0.2}


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
