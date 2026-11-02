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


def test_scoring_before_any_training_is_a_clear_503(tmp_path):
    response = build(tmp_path).post("/anomalies/score", json={"transactionIds": [1]}, headers=HEADERS)

    assert response.status_code == 503 and "POST /train first" in response.json()["detail"]


def test_training_the_anomaly_model_reports_what_it_flagged_and_no_label_metrics(trained):
    client, outcome = trained

    assert outcome["kind"] == "anomaly" and outcome["activated"] is True
    assert re.fullmatch(r"anomaly-20261101-[0-9a-f]{8}", outcome["version"])
    metrics = outcome["metrics"]
    assert metrics["transactions"] == 2978 and metrics["flagged"] > 0
    assert metrics["flagged"] == metrics["flagged_by_rule"] + metrics["flagged_by_model"] - metrics["flagged_by_both"]
    assert "Labels are never used" in metrics["note"]
    assert client.get("/health").json()["models"]["anomaly"] == outcome["version"]


def test_a_negative_adjustment_and_an_off_hours_issue_are_flagged_by_their_rules(trained):
    client, outcome = trained
    ids = [label_row_id("A-02"), label_row_id("A-03")]

    body = client.post("/anomalies/score", json={"transactionIds": ids}, headers=HEADERS).json()
    by_id = {flag["inventoryTransactionId"]: flag for flag in body["flags"]}

    assert body["modelVersion"] == outcome["version"] and body["scored"] == 2 and body["flagged"] == 2
    assert by_id[ids[0]]["source"] == "RULE" and by_id[ids[0]]["ruleCodes"] == ["R1"]
    assert "Negative adjustment of 5 units" in by_id[ids[0]]["reason"]
    assert by_id[ids[1]]["ruleCodes"] == ["R3"] and "outside business hours" in by_id[ids[1]]["reason"]
    assert by_id[ids[1]]["occurredAt"].endswith(".000Z") and by_id[ids[1]]["type"] == "ISSUE"


def test_flags_are_sorted_by_score_highest_first(trained):
    client, _ = trained
    ids = [label_row_id(a) for a in ("A-01", "A-02", "A-03", "A-04", "A-07")]

    scores = [f["score"] for f in client.post("/anomalies/score", json={"transactionIds": ids}, headers=HEADERS).json()["flags"]]

    assert scores == sorted(scores, reverse=True) and len(scores) == 5


def test_include_all_returns_unflagged_rows_without_a_source_or_a_reason(trained):
    client, _ = trained
    ordinary = int(LEDGER[LEDGER["type"] == "RESERVATION"]["id"].iloc[0])

    only_flagged = client.post("/anomalies/score", json={"transactionIds": [ordinary]}, headers=HEADERS).json()
    everything = client.post("/anomalies/score", json={"transactionIds": [ordinary], "includeAll": True}, headers=HEADERS).json()

    assert only_flagged["scored"] == 1 and only_flagged["flagged"] == 0 and only_flagged["flags"] == []
    row = everything["flags"][0]
    assert row["flagged"] is False and row["source"] is None and row["reason"] is None and row["ruleCodes"] == []
    assert 0.0 <= row["modelScore"] <= 1.0


def test_unknown_transaction_ids_are_reported_not_fatal(trained):
    client, _ = trained

    body = client.post("/anomalies/score", json={"transactionIds": [label_row_id("A-02"), 987654]}, headers=HEADERS).json()

    assert body["scored"] == 1 and body["notFoundIds"] == [987654]


def test_a_model_only_flag_explains_itself(trained):
    client, _ = trained

    body = client.post(
        "/anomalies/score",
        json={"from": "2026-08-01T00:00:00Z", "to": "2026-08-10T00:00:00Z"},
        headers=HEADERS,
    ).json()
    model_only = [f for f in body["flags"] if f["source"] == "MODEL"]

    assert model_only, "the opening receipts should be model flags in this range"
    for flag in model_only:
        assert flag["reason"].startswith(f"Model score {flag['modelScore']:.3f}.")
        assert "Statistically unusual" in flag["reason"] and flag["ruleCodes"] == []


def test_a_time_range_selects_exactly_the_rows_in_it_with_an_exclusive_end(trained):
    client, _ = trained
    start, end = pd.Timestamp("2026-10-20 00:00"), pd.Timestamp("2026-10-22 00:00")
    expected = LEDGER[(LEDGER["created_at"] >= start) & (LEDGER["created_at"] < end)]

    body = client.post(
        "/anomalies/score",
        json={"from": "2026-10-20T00:00:00Z", "to": "2026-10-22T00:00:00Z", "includeAll": True},
        headers=HEADERS,
    ).json()

    assert body["scored"] == len(expected) > 0
    assert {f["inventoryTransactionId"] for f in body["flags"]} == set(expected["id"])


def test_the_end_of_a_range_is_exclusive_and_the_start_inclusive(trained):
    client, _ = trained
    row = LEDGER[LEDGER["type"] == "ISSUE"].iloc[100]
    at = pd.Timestamp(row["created_at"])
    iso = lambda t: t.isoformat() + "Z"
    ids = lambda body: {f["inventoryTransactionId"] for f in client.post("/anomalies/score", json={**body, "includeAll": True}, headers=HEADERS).json()["flags"]}

    assert int(row["id"]) not in ids({"from": iso(at - pd.Timedelta(hours=1)), "to": iso(at)})  # `to` is exclusive
    assert int(row["id"]) in ids({"from": iso(at), "to": iso(at + pd.Timedelta(hours=1))})  # `from` is inclusive
    assert int(row["id"]) in ids({"from": iso(at - pd.Timedelta(hours=1)), "to": iso(at + pd.Timedelta(seconds=1))})


def test_time_zones_in_a_range_are_converted_to_utc(trained):
    client, _ = trained
    utc = client.post("/anomalies/score", json={"from": "2026-10-20T04:00:00Z", "to": "2026-10-20T08:00:00Z", "includeAll": True}, headers=HEADERS).json()
    local = client.post("/anomalies/score", json={"from": "2026-10-20T10:00:00+06:00", "to": "2026-10-20T14:00:00+06:00", "includeAll": True}, headers=HEADERS).json()
    naive = client.post("/anomalies/score", json={"from": "2026-10-20T04:00:00", "to": "2026-10-20T08:00:00", "includeAll": True}, headers=HEADERS).json()

    assert utc["scored"] == local["scored"] == naive["scored"] > 0


def test_scoring_one_transaction_gives_the_same_answer_as_scoring_its_whole_day(trained):
    client, _ = trained
    row_id = label_row_id("A-06")  # the duplicate: its score depends on the movement just before it
    one = client.post("/anomalies/score", json={"transactionIds": [row_id], "includeAll": True}, headers=HEADERS).json()["flags"][0]
    stamp = pd.Timestamp(LABELS["A-06"]["occurredAt"]).tz_localize(None)
    day = client.post(
        "/anomalies/score",
        json={"from": (stamp.normalize()).isoformat() + "Z", "to": (stamp.normalize() + pd.Timedelta(days=1)).isoformat() + "Z", "includeAll": True},
        headers=HEADERS,
    ).json()["flags"]

    same = next(f for f in day if f["inventoryTransactionId"] == row_id)
    assert same["modelScore"] == one["modelScore"] and same["score"] == one["score"]


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
    ],
)
def test_invalid_scoring_requests_are_422(trained, body):
    client, _ = trained

    assert client.post("/anomalies/score", json=body, headers=HEADERS).status_code == 422


# ---- training ------------------------------------------------------------------------------------------------------------


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
