import pandas as pd
import pytest
from sklearn.metrics import average_precision_score, roc_auc_score

from app.anomaly.evaluate import _find, evaluate_anomaly_detection, load_labels
from app.anomaly.model import fit_anomaly_model, score_ledger
from app.data.sources import CsvSource
from tests.conftest import FIXTURES


@pytest.fixture(scope="module")
def real():
    source = CsvSource(FIXTURES)
    ledger = source.ledger()
    scored = score_ledger(fit_anomaly_model(ledger), ledger)
    labels = load_labels(FIXTURES / "anomaly-labels.json")

    return source, ledger, scored, labels, evaluate_anomaly_detection(scored, ledger, source.products(), source.warehouses(), labels)


# ---- hand-computed: a small world where every number can be checked by eye -------------------------------


def small_world():
    ledger = pd.DataFrame(
        {
            "id": range(1, 11),
            "product_id": 1,
            "warehouse_id": 1,
            "type": "ISSUE",
            "quantity": [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10],
            "created_at": pd.date_range("2026-10-01 04:00", periods=10, freq="h"),
        }
    )
    products = pd.DataFrame({"id": [1], "sku": ["S1"], "name": ["x"]})
    warehouses = pd.DataFrame({"id": [1], "code": ["W1"], "name": ["w"]})

    def label(label_id, row_id, kind, related=None):
        row = ledger[ledger["id"] == row_id].iloc[0]
        natural = {
            "sku": "S1", "warehouseCode": "W1", "ledgerType": "ISSUE", "quantity": int(row["quantity"]),
            "occurredAt": row["created_at"].strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        }

        return {"id": label_id, "anomalyType": kind, **natural, "expectedDetection": "BOTH", "severity": "HIGH",
                "visibleInDemo": False, "related": related}

    related = label("x", 7, "X")  # the original of a duplicate: only its natural key is used
    labels = {"anomalies": [label("A1", 2, "TYPE_A"), label("A2", 5, "TYPE_B"), label("A3", 8, "TYPE_B", related=related)]}

    scored = pd.DataFrame(
        {
            "id": range(1, 11),
            "product_id": 1,
            "warehouse_id": 1,
            "type": "ISSUE",
            "quantity": ledger["quantity"],
            "created_at": ledger["created_at"],
            # rules fire on 2 (a label) and 9 (not a label)
            "rule_flag": [i in (2, 9) for i in range(1, 11)],
            # the model fires on 5 (a label), 7 (the related original: ignored) and 10 (not a label)
            "model_flag": [i in (5, 7, 10) for i in range(1, 11)],
            "model_score": [0.10, 0.99, 0.20, 0.30, 0.98, 0.40, 0.97, 0.50, 0.96, 0.95],
            "rule_codes": [["R1"] if i in (2, 9) else float("nan") for i in range(1, 11)],
        }
    )
    scored["flagged"] = scored["rule_flag"] | scored["model_flag"]
    scored["source"] = ""

    return scored, ledger, products, warehouses, labels


def test_metrics_for_every_detector_match_a_hand_count():
    scored, ledger, products, warehouses, labels = small_world()

    ev = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)
    overall = ev.overall.set_index("detector")

    # rules: caught A1 only; their other flag (row 9) is a false positive
    assert overall.loc["rules", ["true_positives", "missed", "false_positives"]].tolist() == [1, 2, 1]
    assert overall.loc["rules", "precision"] == pytest.approx(1 / 2) and overall.loc["rules", "recall"] == pytest.approx(1 / 3)
    # model: caught A2; row 7 is the related original (neither hit nor false alarm); row 10 is a false positive
    assert overall.loc["model", ["true_positives", "missed", "false_positives"]].tolist() == [1, 2, 1]
    # combined: A1 and A2 caught, rows 9 and 10 are false positives, A3 missed
    assert overall.loc["combined", ["true_positives", "missed", "false_positives"]].tolist() == [2, 1, 2]
    assert overall.loc["combined", "precision"] == pytest.approx(2 / 4) and overall.loc["combined", "recall"] == pytest.approx(2 / 3)
    assert sorted(ev.false_positives["id"]) == [9, 10]


def test_per_type_counts_add_up():
    scored, ledger, products, warehouses, labels = small_world()

    by_type = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels).by_type.set_index("anomaly_type")

    assert by_type.loc["TYPE_A", ["injected", "rules_detected", "model_detected", "combined_detected"]].tolist() == [1, 1, 0, 1]
    assert by_type.loc["TYPE_B", ["injected", "rules_detected", "model_detected", "combined_detected"]].tolist() == [2, 0, 1, 1]
    assert by_type.loc["TYPE_B", ["rules_missed", "model_missed", "combined_missed"]].tolist() == [2, 1, 1]


def test_ranking_numbers_ignore_the_related_original_and_agree_with_sklearn():
    scored, ledger, products, warehouses, labels = small_world()

    ev = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)

    kept = scored[scored["id"] != 7]
    truth = kept["id"].isin([2, 5, 8]).astype(int)
    assert ev.ranking["average_precision"] == pytest.approx(average_precision_score(truth, kept["model_score"]))
    assert ev.ranking["roc_auc"] == pytest.approx(roc_auc_score(truth, kept["model_score"]))
    assert ev.ranking["baseline_average_precision"] == pytest.approx(3 / 9)
    # by score the order is 2, 5, 9, 10, 8..., so the top 2 hold two labels and the top 4 still two
    assert ev.ranking["recall_at_k"] == {"10": 3, "20": 3, "50": 3}


def test_model_ranks_are_one_for_the_most_anomalous_row():
    scored, ledger, products, warehouses, labels = small_world()

    labelled = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels).labelled.set_index("label")

    assert labelled.loc["A1", "model_rank"] == 1 and labelled.loc["A2", "model_rank"] == 2


def test_a_label_that_matches_no_ledger_row_is_an_error():
    scored, ledger, products, warehouses, labels = small_world()
    labels["anomalies"][0]["quantity"] = -999

    with pytest.raises(ValueError, match="exactly one ledger row"):
        evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)


def test_a_label_that_matches_two_rows_is_an_error():
    scored, ledger, products, warehouses, labels = small_world()
    twin = ledger.iloc[[1]].copy()
    twin["id"] = 99
    ledger = pd.concat([ledger, twin], ignore_index=True)

    with pytest.raises(ValueError, match="exactly one ledger row"):
        evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)


# ---- the seeded data, end to end -------------------------------------------------------------------------------


def test_every_label_resolves_to_one_real_row(real):
    source, ledger, scored, labels, ev = real

    assert len(ev.labelled) == 8 == labels["count"]
    for label in labels["anomalies"]:
        _find(ledger, source.products(), source.warehouses(), label)


def test_the_flags_are_an_honest_union_of_rules_and_model(real):
    _, _, scored, _, ev = real
    overall = ev.overall.set_index("detector")

    assert overall.loc["combined", "true_positives"] >= max(overall.loc["rules", "true_positives"], overall.loc["model", "true_positives"])
    assert overall.loc["combined", "recall"] == pytest.approx(
        ((ev.labelled["rules"] | ev.labelled["model"]).sum()) / 8
    )
    assert (scored["flagged"] == (scored["rule_flag"] | scored["model_flag"])).all()
    assert overall["true_positives"].add(overall["missed"]).eq(8).all()


def test_the_related_original_of_the_duplicate_is_never_counted_as_a_false_positive(real):
    source, ledger, _, labels, ev = real
    duplicate = next(a for a in labels["anomalies"] if a["anomalyType"] == "DUPLICATE_ISSUE")
    original_id = _find(ledger, source.products(), source.warehouses(), duplicate["related"])

    assert original_id not in set(ev.false_positives["id"])
    assert not set(ev.labelled["id"]) & set(ev.false_positives["id"])


def test_the_model_score_ranks_labelled_rows_far_better_than_chance(real):
    _, _, _, _, ev = real

    assert ev.ranking["roc_auc"] > 0.75
    assert ev.ranking["average_precision"] > 5 * ev.ranking["baseline_average_precision"]
    top = ev.ranking["recall_at_k"]
    assert top["10"] <= top["20"] <= top["50"] <= ev.ranking["labelled"]


def test_the_labels_play_no_part_in_what_was_scored(real):
    _, ledger, scored, _, _ = real
    other = score_ledger(fit_anomaly_model(ledger), ledger)  # a second fit that never touched the labels

    pd.testing.assert_series_equal(scored["model_score"], other["model_score"])


def test_the_summary_dict_is_json_ready(real):
    import json

    from app.versioning import to_jsonable

    _, _, _, _, ev = real
    text = json.dumps(to_jsonable(ev.as_dict()), allow_nan=False)

    assert json.loads(text)["labelled"] == 8
