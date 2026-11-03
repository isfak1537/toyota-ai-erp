import re

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.anomaly.evaluate import _find, load_labels
from app.config import Settings
from app.data.sources import CsvSource
from app.main import create_app
from app.registry import ModelRegistry
from tests.conftest import FIXTURES, SECRET

HEADERS = {"X-AI-Service-Secret": SECRET}
SOURCE = CsvSource(FIXTURES)
LEDGER = SOURCE.ledger()
LABELS = {a["id"]: a for a in load_labels(FIXTURES / "anomaly-labels.json")["anomalies"]}


def label_row_id(label_id):
    return _find(LEDGER, SOURCE.products(), SOURCE.warehouses(), LABELS[label_id])


def build(tmp_path):
    settings = Settings.from_env({"AI_SERVICE_SECRET": SECRET, "AI_MODEL_DIR": str(tmp_path / "models")})

    return TestClient(create_app(settings, source=SOURCE, registry=ModelRegistry(settings.model_dir)))


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    client = build(tmp_path_factory.mktemp("anomaly-api"))
    response = client.post("/train", json={"models": ["anomaly"]}, headers=HEADERS)
    assert response.status_code == 200, response.text

    return client, response.json()["trained"][0]


def score(client, **body):
    response = client.post("/anomalies/score", json=body, headers=HEADERS)
    assert response.status_code == 200, response.text

    return response.json()


WEEK_ONE = {"from": "2026-10-18T00:00:00Z", "to": "2026-11-02T00:00:00Z"}  # two local weeks and a bit


def test_scoring_before_any_training_is_a_clear_503(tmp_path):
    response = build(tmp_path).post("/anomalies/score", json={"transactionIds": [1]}, headers=HEADERS)

    assert response.status_code == 503 and "POST /train first" in response.json()["detail"]


def test_training_the_anomaly_model_reports_what_it_flagged_and_no_label_metrics(trained):
    client, outcome = trained

    assert outcome["kind"] == "anomaly" and outcome["activated"] is True
    assert re.fullmatch(r"anomaly-20261101-[0-9a-f]{8}", outcome["version"])
    metrics = outcome["metrics"]
    assert metrics["transactions"] == 2978 and 0 < metrics["eligible_transactions"] < 2978 and metrics["flagged"] > 0
    assert metrics["flagged"] == metrics["flagged_by_rule"] + metrics["in_review_queue"] - metrics["flagged_by_both"]
    assert metrics["queue"] == {"size": 10, "period": "week"}
    assert "Labels are never used" in metrics["note"]
    assert client.get("/health").json()["models"]["anomaly"] == outcome["version"]


# ---- rules ---------------------------------------------------------------------------------------------------------------------


def test_with_the_queue_off_only_the_rules_flag_and_say_which(trained):
    client, outcome = trained
    ids = [label_row_id("A-02"), label_row_id("A-03")]

    body = score(client, transactionIds=ids, queueSize=0)
    by_id = {flag["inventoryTransactionId"]: flag for flag in body["flags"]}

    assert body["modelVersion"] == outcome["version"] and body["scored"] == 2 and body["flagged"] == 2
    assert body["queue"] == {"size": 0, "period": "week"}
    assert by_id[ids[0]]["source"] == "RULE" and by_id[ids[0]]["ruleCodes"] == ["R1"] and by_id[ids[0]]["queueRank"] is None
    assert "Negative adjustment of 5 units" in by_id[ids[0]]["reason"]
    assert by_id[ids[1]]["ruleCodes"] == ["R3"] and "outside business hours" in by_id[ids[1]]["reason"]
    assert by_id[ids[1]]["occurredAt"].endswith(".000Z") and by_id[ids[1]]["type"] == "ISSUE"


def test_the_duplicate_is_flagged_by_rule_r5(trained):
    client, _ = trained

    flag = score(client, transactionIds=[label_row_id("A-06")], queueSize=0)["flags"][0]

    assert flag["ruleCodes"] == ["R5"] and "3 minutes after the previous one" in flag["reason"]


# ---- the review queue -----------------------------------------------------------------------------------------------------------


def test_each_period_gets_at_most_n_queued_rows_ranked_by_risk(trained):
    client, _ = trained

    body = score(client, **WEEK_ONE, queueSize=3, includeAll=True)
    queued = [f for f in body["flags"] if f["queueRank"] is not None]

    assert body["queue"] == {"size": 3, "period": "week"}
    assert len({f["period"] for f in queued}) >= 3 and all(re.fullmatch(r"\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}", f["period"]) for f in queued)
    for period in {f["period"] for f in queued}:
        rows = sorted((f for f in queued if f["period"] == period), key=lambda f: f["queueRank"])
        assert [f["queueRank"] for f in rows] == list(range(1, len(rows) + 1))
        assert [f["riskScore"] for f in rows] == sorted((f["riskScore"] for f in rows), reverse=True)
        assert len(rows) <= 3


def test_a_queued_row_carries_its_risk_score_and_top_contributing_features(trained):
    client, _ = trained

    body = score(client, **WEEK_ONE, queueSize=2, includeAll=True)
    queued = [f for f in body["flags"] if f["queueRank"] is not None]

    assert queued
    for flag in queued:
        assert flag["flagged"] is True and flag["source"] in ("MODEL", "BOTH") and 0.0 <= flag["riskScore"] <= 1.0
        assert 1 <= len(flag["topFeatures"]) <= 3
        for feature in flag["topFeatures"]:
            assert set(feature) == {"feature", "text", "value", "typical", "contribution"} and feature["contribution"] >= 0.001
            assert feature["text"][0].isupper() and feature["text"].endswith(".")
    assert all(f["topFeatures"] == [] for f in body["flags"] if f["queueRank"] is None)


def test_a_queue_only_flag_explains_its_rank(trained):
    client, _ = trained

    body = score(client, **WEEK_ONE, queueSize=5)
    model_only = [f for f in body["flags"] if f["source"] == "MODEL"]

    assert model_only
    for flag in model_only:
        assert re.match(rf"Risk {flag['riskScore']:.3f}, rank {flag['queueRank']} in the review queue of {flag['period']}\. Statistically unusual", flag["reason"])
        assert flag["ruleCodes"] == []


def test_documented_receipts_and_reservations_can_never_be_queued(trained):
    client, _ = trained
    documented = LEDGER[(LEDGER["type"] == "RECEIPT") & LEDGER["reference_id"].notna()]
    reservations = LEDGER[LEDGER["type"] == "RESERVATION"]
    ids = [int(i) for i in documented["id"].head(40)] + [int(i) for i in reservations["id"].head(40)]

    body = score(client, transactionIds=ids, queueSize=100, includeAll=True)

    assert body["scored"] == 80
    assert all(f["eligibleForQueue"] is False and f["queueRank"] is None and f["topFeatures"] == [] for f in body["flags"])
    assert all(f["source"] in (None, "RULE") for f in body["flags"])  # at most a rule can flag them
    assert all(0.0 <= f["riskScore"] <= 1.0 for f in body["flags"])  # they are still scored


def test_the_queue_period_can_be_a_day(trained):
    client, _ = trained

    body = score(client, **WEEK_ONE, queueSize=1, queuePeriod="day", includeAll=True)
    queued = [f for f in body["flags"] if f["queueRank"] is not None]

    assert body["queue"]["period"] == "day"
    assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", f["period"]) for f in queued)
    assert len({f["period"] for f in queued}) == len(queued)  # exactly one per day


def test_a_larger_queue_contains_the_smaller_one(trained):
    client, _ = trained

    small = {f["inventoryTransactionId"] for f in score(client, **WEEK_ONE, queueSize=2)["flags"] if f["source"] in ("MODEL", "BOTH")}
    large = {f["inventoryTransactionId"] for f in score(client, **WEEK_ONE, queueSize=6)["flags"] if f["source"] in ("MODEL", "BOTH")}

    assert small and small < large


def test_flags_are_sorted_by_score_highest_first(trained):
    client, _ = trained
    ids = [label_row_id(a) for a in ("A-01", "A-02", "A-03", "A-04", "A-07")]

    scores = [f["score"] for f in score(client, transactionIds=ids)["flags"]]

    assert scores == sorted(scores, reverse=True) and len(scores) == 5


def test_include_all_returns_unflagged_rows_without_a_source_or_a_reason(trained):
    client, _ = trained
    ordinary = int(LEDGER[LEDGER["type"] == "RESERVATION"]["id"].iloc[0])

    only_flagged = score(client, transactionIds=[ordinary])
    everything = score(client, transactionIds=[ordinary], includeAll=True)

    assert only_flagged["scored"] == 1 and only_flagged["flagged"] == 0 and only_flagged["flags"] == []
    row = everything["flags"][0]
    assert row["flagged"] is False and row["source"] is None and row["reason"] is None and row["ruleCodes"] == []
    assert row["queueRank"] is None and row["eligibleForQueue"] is False and 0.0 <= row["riskScore"] <= 1.0


def test_unknown_transaction_ids_are_reported_not_fatal(trained):
    client, _ = trained

    body = score(client, transactionIds=[label_row_id("A-02"), 987654])

    assert body["scored"] == 1 and body["notFoundIds"] == [987654]


# ---- selecting what to score ---------------------------------------------------------------------------------------------------------


def test_a_time_range_selects_exactly_the_rows_in_it(trained):
    client, _ = trained
    start, end = pd.Timestamp("2026-10-20 00:00"), pd.Timestamp("2026-10-22 00:00")
    expected = LEDGER[(LEDGER["created_at"] >= start) & (LEDGER["created_at"] < end)]

    body = score(client, **{"from": "2026-10-20T00:00:00Z", "to": "2026-10-22T00:00:00Z"}, includeAll=True)

    assert body["scored"] == len(expected) > 0
    assert {f["inventoryTransactionId"] for f in body["flags"]} == set(expected["id"])


def test_the_end_of_a_range_is_exclusive_and_the_start_inclusive(trained):
    client, _ = trained
    row = LEDGER[LEDGER["type"] == "ISSUE"].iloc[100]
    at = pd.Timestamp(row["created_at"])
    iso = lambda t: t.isoformat() + "Z"
    ids = lambda **body: {f["inventoryTransactionId"] for f in score(client, **body, includeAll=True)["flags"]}

    assert int(row["id"]) not in ids(**{"from": iso(at - pd.Timedelta(hours=1)), "to": iso(at)})  # `to` is exclusive
    assert int(row["id"]) in ids(**{"from": iso(at), "to": iso(at + pd.Timedelta(hours=1))})  # `from` is inclusive
    assert int(row["id"]) in ids(**{"from": iso(at - pd.Timedelta(hours=1)), "to": iso(at + pd.Timedelta(seconds=1))})


def test_time_zones_in_a_range_are_converted_to_utc(trained):
    client, _ = trained
    utc = score(client, **{"from": "2026-10-20T04:00:00Z", "to": "2026-10-20T08:00:00Z"}, includeAll=True)
    local = score(client, **{"from": "2026-10-20T10:00:00+06:00", "to": "2026-10-20T14:00:00+06:00"}, includeAll=True)
    naive = score(client, **{"from": "2026-10-20T04:00:00", "to": "2026-10-20T08:00:00"}, includeAll=True)

    assert utc["scored"] == local["scored"] == naive["scored"] > 0


def test_scoring_one_transaction_gives_the_same_risk_as_scoring_its_whole_day(trained):
    client, _ = trained
    row_id = label_row_id("A-06")  # the duplicate: its risk depends on the movement just before it
    one = score(client, transactionIds=[row_id], includeAll=True)["flags"][0]
    stamp = pd.Timestamp(LABELS["A-06"]["occurredAt"]).tz_localize(None)
    day = score(
        client, **{"from": stamp.normalize().isoformat() + "Z", "to": (stamp.normalize() + pd.Timedelta(days=1)).isoformat() + "Z"}, includeAll=True
    )["flags"]

    same = next(f for f in day if f["inventoryTransactionId"] == row_id)
    assert same["riskScore"] == one["riskScore"] and same["ruleCodes"] == one["ruleCodes"]


def test_scoring_is_deterministic(trained):
    client, _ = trained
    body = {"from": "2026-10-01T00:00:00Z", "to": "2026-10-15T00:00:00Z"}

    assert client.post("/anomalies/score", json=body, headers=HEADERS).json() == client.post("/anomalies/score", json=body, headers=HEADERS).json()


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"includeAll": True},
        {"transactionIds": []},
        {"transactionIds": [0]},
        {"transactionIds": [-4]},
        {"transactionIds": ["x"]},
        {"transactionIds": list(range(1, 5002))},
        {"from": "2026-10-01T00:00:00Z"},
        {"to": "2026-10-01T00:00:00Z"},
        {"from": "2026-10-02T00:00:00Z", "to": "2026-10-01T00:00:00Z"},
        {"from": "2026-10-01T00:00:00Z", "to": "2026-10-01T00:00:00Z"},
        {"from": "2026-09-01T00:00:00Z", "to": "2026-10-15T00:00:00Z"},
        {"from": "garbage", "to": "2026-10-15T00:00:00Z"},
        {"transactionIds": [1], "from": "2026-10-01T00:00:00Z", "to": "2026-10-02T00:00:00Z"},
        {"transactionIds": [1], "surprise": 1},
        {"transactionIds": [1], "queueSize": -1},
        {"transactionIds": [1], "queueSize": 101},
        {"transactionIds": [1], "queueSize": "ten"},
        {"transactionIds": [1], "queuePeriod": "month"},
    ],
)
def test_invalid_scoring_requests_are_422(trained, body):
    client, _ = trained

    assert client.post("/anomalies/score", json=body, headers=HEADERS).status_code == 422


# ---- training ------------------------------------------------------------------------------------------------------------------------------


def test_training_everything_by_default_leaves_both_models_active(tmp_path):
    client = build(tmp_path)

    trained = client.post("/train", json={}, headers=HEADERS).json()["trained"]
    models = client.get("/health").json()["models"]

    assert [t["kind"] for t in trained] == ["forecast", "anomaly"]
    assert models == {t["kind"]: t["version"] for t in trained}


def test_training_one_model_leaves_the_other_untouched(tmp_path):
    client = build(tmp_path)
    both = {t["kind"]: t["version"] for t in client.post("/train", json={}, headers=HEADERS).json()["trained"]}

    client.post("/train", json={"models": ["anomaly"], "asOf": "2026-10-20"}, headers=HEADERS)
    models = client.get("/health").json()["models"]

    assert models["forecast"] == both["forecast"] and models["anomaly"] != both["anomaly"]
    assert "20261020" in models["anomaly"]


def test_training_up_to_an_earlier_day_uses_only_the_transactions_before_its_end(tmp_path):
    client = build(tmp_path)

    early = client.post("/train", json={"models": ["anomaly"], "asOf": "2026-09-01"}, headers=HEADERS).json()["trained"][0]["metrics"]
    expected = int((LEDGER["created_at"] < pd.Timestamp("2026-09-01 18:00")).sum())  # local day ends 18:00 UTC

    assert early["transactions"] == expected < 2978


def test_requesting_the_same_model_twice_trains_it_once(tmp_path):
    client = build(tmp_path)

    trained = client.post("/train", json={"models": ["anomaly", "anomaly"]}, headers=HEADERS).json()["trained"]

    assert [t["kind"] for t in trained] == ["anomaly"]
