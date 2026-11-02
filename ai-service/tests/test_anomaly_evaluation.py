import pandas as pd
import pytest
from sklearn.metrics import average_precision_score, roc_auc_score

from app.anomaly.evaluate import _find, evaluate_anomaly_detection, load_labels, queue_metrics
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
            "risk_score": [0.10, 0.99, 0.20, 0.30, 0.98, 0.40, 0.97, 0.50, 0.96, 0.95],
            "rule_codes": [["R1"] if i in (2, 9) else float("nan") for i in range(1, 11)],
            "eligible": True,
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
    assert ev.ranking["average_precision"] == pytest.approx(average_precision_score(truth, kept["risk_score"]))
    assert ev.ranking["roc_auc"] == pytest.approx(roc_auc_score(truth, kept["risk_score"]))
    assert ev.ranking["baseline_average_precision"] == pytest.approx(3 / 9)
    # by score the order is 2, 5, 9, 10, 8..., so the top 2 hold two labels and the top 4 still two
    assert ev.ranking["recall_at_k"] == {"10": 3, "20": 3, "50": 3}
    assert ev.ranking["eligible_transactions"] == 9


def test_model_ranks_are_one_for_the_most_anomalous_row():
    scored, ledger, products, warehouses, labels = small_world()

    labelled = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels).labelled.set_index("label")

    assert labelled.loc["A1", "model_rank"] == 1 and labelled.loc["A2", "model_rank"] == 2


def test_only_eligible_rows_count_in_the_ranking_and_the_ranks():
    scored, ledger, products, warehouses, labels = small_world()
    scored.loc[scored["id"] == 9, "eligible"] = False  # a row that can never be queued, whatever its score

    ev = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)

    assert ev.ranking["eligible_transactions"] == 8
    labelled = ev.labelled.set_index("label")
    assert labelled.loc["A1", "model_rank"] == 1 and labelled.loc["A2", "model_rank"] == 2  # ranks among eligible rows only


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


def test_the_risk_score_ranks_labelled_rows_far_better_than_chance(real):
    _, _, _, _, ev = real

    assert ev.ranking["roc_auc"] > 0.75
    assert ev.ranking["average_precision"] > 5 * ev.ranking["baseline_average_precision"]
    top = ev.ranking["recall_at_k"]
    assert top["10"] <= top["20"] <= top["50"] <= ev.ranking["labelled"]


def test_the_labels_play_no_part_in_what_was_scored(real):
    _, ledger, scored, _, _ = real
    other = score_ledger(fit_anomaly_model(ledger), ledger)  # a second fit that never touched the labels

    pd.testing.assert_series_equal(scored["risk_score"], other["risk_score"])


def test_the_summary_dict_is_json_ready(real):
    import json

    from app.versioning import to_jsonable

    _, _, _, _, ev = real
    text = json.dumps(to_jsonable(ev.as_dict()), allow_nan=False)

    assert json.loads(text)["labelled"] == 8


# ---- why a flagged row was not a labelled anomaly -----------------------------------------------------------


def test_false_positives_are_given_a_likely_cause():
    from app.anomaly.evaluate import categorize_false_positives, is_data_artefact

    ledger = pd.DataFrame({"created_at": pd.to_datetime(["2026-08-04 02:30", "2026-11-01 10:30"])})
    labels = {"endDate": "2026-11-01"}
    rows = [
        ("RECEIPT", "SYN-A", "2026-08-04 02:30"),  # opening stock, day one
        ("ISSUE", "SYN-A", "2026-11-01 10:30"),  # the generator's last-day trim
        ("ISSUE", "SYN-STEER", "2026-10-25 05:00"),  # steered product inside its last 12 days
        ("ISSUE", "SYN-STEER", "2026-10-10 05:00"),  # steered product, but earlier: natural
        ("ISSUE", "SYN-A", "2026-10-25 05:00"),  # not steered: natural
        ("RECEIPT", "SYN-A", "2026-09-10 03:00"),  # an ordinary large replenishment receipt
        ("ISSUE", "SYN-STEER", "2026-10-21 05:00"),  # the first day of the 12-day window (day index 78): steered
        ("ISSUE", "SYN-STEER", "2026-10-20 05:00"),  # the day before the window: natural
    ]
    frame = pd.DataFrame(rows, columns=["type", "sku", "created_at"])
    frame["created_at"] = pd.to_datetime(frame["created_at"])

    out = categorize_false_positives(frame, ledger, labels, {"SYN-STEER"})
    causes = list(out["likely_cause"])

    assert causes[0].startswith("opening stock") and causes[1].startswith("last-day trim")
    assert causes[2].startswith("steered demo product")
    assert causes[3].startswith("ordinary large movement") and causes[4].startswith("ordinary large movement")
    assert causes[5].startswith("large goods receipt") and causes[6].startswith("steered demo product")
    assert causes[7].startswith("ordinary large movement")
    assert [is_data_artefact(c) for c in causes] == [True, True, True, False, False, False, True, False]


def test_categorizing_nothing_gives_an_empty_frame_with_the_column():
    from app.anomaly.evaluate import categorize_false_positives

    out = categorize_false_positives(pd.DataFrame(columns=["type", "sku", "created_at"]), pd.DataFrame({"created_at": pd.to_datetime(["2026-08-04"])}), {"endDate": "2026-11-01"}, set())

    assert out.empty and "likely_cause" in out.columns


# ---- precision@N and recall@N of the review queue, counted by hand ------------------------------------------------------------


def queue_world():
    """Twelve eligible rows in one local week; risk falls with the id (1 is the riskiest)."""
    scored = pd.DataFrame(
        {
            "id": range(1, 13),
            "risk_score": [round(0.99 - 0.05 * i, 2) for i in range(12)],
            "eligible": True,
            "created_at": pd.date_range("2026-10-05 04:00", periods=12, freq="h"),  # all in the week 2026-10-04/2026-10-10
            "rule_flag": [i in (11, 12) for i in range(1, 13)],  # the rules catch rows 11 and 12 only
        }
    )
    labelled = pd.DataFrame({"id": [1, 3, 12]})  # three labelled anomalies: ranks 1, 3 and 12 by risk

    return scored, labelled


def test_precision_and_recall_at_n_match_a_hand_count():
    scored, labelled = queue_world()

    out = queue_metrics(scored, labelled, related_ids=set(), sizes=(2, 4, 6)).set_index("n_per_period")

    # N=2 queues rows 1, 2 -> one hit (row 1)
    assert out.loc[2, ["queue_rows", "queue_hits"]].tolist() == [2, 1]
    assert out.loc[2, "precision_at_n"] == pytest.approx(1 / 2) and out.loc[2, "recall_at_n"] == pytest.approx(1 / 3)
    # N=4 queues rows 1-4 -> hits are rows 1 and 3
    assert out.loc[4, "queue_hits"] == 2 and out.loc[4, "precision_at_n"] == pytest.approx(2 / 4)
    assert out.loc[4, "recall_at_n"] == pytest.approx(2 / 3)
    # N=6 adds rows 5, 6 -> no new hit
    assert out.loc[6, "queue_hits"] == 2 and out.loc[6, "precision_at_n"] == pytest.approx(2 / 6)
    assert out["random_precision"].tolist() == pytest.approx([3 / 12] * 3)
    assert out["periods"].tolist() == [1, 1, 1]


def test_the_rules_extend_the_queue_without_double_counting():
    scored, labelled = queue_world()

    out = queue_metrics(scored, labelled, related_ids=set(), sizes=(2,)).iloc[0]

    # queue {1, 2} plus rule hits {11, 12} -> four rows, hits are 1 and 12
    assert out["queue_plus_rules_rows"] == 4 and out["queue_plus_rules_hits"] == 2
    assert out["queue_plus_rules_precision"] == pytest.approx(2 / 4) and out["queue_plus_rules_recall"] == pytest.approx(2 / 3)


def test_a_queued_related_original_is_neither_a_hit_nor_a_false_alarm():
    scored, labelled = queue_world()

    out = queue_metrics(scored, labelled, related_ids={2}, sizes=(2,)).iloc[0]  # row 2 is the original of a duplicate

    assert out["queue_rows"] == 1 and out["queue_hits"] == 1
    assert out["precision_at_n"] == pytest.approx(1 / 1)


def test_the_queue_is_cut_per_period_so_n_applies_to_every_week():
    scored, labelled = queue_world()
    later = scored.copy()
    later["id"] += 100
    later["created_at"] += pd.Timedelta(days=7)  # the same twelve rows, one week later
    both = pd.concat([scored, later], ignore_index=True)

    out = queue_metrics(both, labelled, related_ids=set(), sizes=(2,)).iloc[0]

    assert out["periods"] == 2 and out["queue_rows"] == 4 and out["queue_hits"] == 1  # 2 per week; only week one has a labelled row


def test_only_eligible_rows_can_be_queued_in_the_metrics():
    scored, labelled = queue_world()
    scored.loc[scored["id"] == 1, "eligible"] = False

    out = queue_metrics(scored, labelled, related_ids=set(), sizes=(2,)).iloc[0]

    # row 1 can no longer be queued: the queue is now rows 2 and 3, so only row 3 is a hit and row 1 is lost for good
    assert out["queue_rows"] == 2 and out["queue_hits"] == 1 and out["recall_at_n"] == pytest.approx(1 / 3)
    assert out["random_precision"] == pytest.approx(3 / 11)  # the baseline is over the 11 rows that CAN be queued
