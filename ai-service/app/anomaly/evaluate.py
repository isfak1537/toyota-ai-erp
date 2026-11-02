"""Evaluate anomaly detection against the injected ground truth (anomaly-labels.json).

The labels are used ONLY here. They never reach training, thresholds or rules.

A label identifies its ledger row by a natural key (sku, warehouse code, time,
type, quantity). A flag is
  * a true positive   if it is the labelled row,
  * ignored           if it is the 'related' original of a labelled duplicate,
  * a false positive  otherwise.
Everything is reported separately for the rules, the model and both combined.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

DETECTORS = {"rules": "rule_flag", "model": "model_flag", "combined": "flagged"}
TOP_K = (10, 20, 50)


def load_labels(path: str | Path) -> dict:
    return json.loads(Path(path).read_text())


def _find(ledger: pd.DataFrame, products: pd.DataFrame, warehouses: pd.DataFrame, natural: dict) -> int:
    sku = products.set_index("sku")["id"]
    code = warehouses.set_index("code")["id"]
    when = pd.Timestamp(natural["occurredAt"]).tz_convert("UTC").tz_localize(None)

    hit = ledger[
        (ledger["product_id"] == sku[natural["sku"]])
        & (ledger["warehouse_id"] == code[natural["warehouseCode"]])
        & (ledger["created_at"] == when)
        & (ledger["type"] == natural["ledgerType"])
        & (ledger["quantity"] == natural["quantity"])
    ]

    if len(hit) != 1:
        raise ValueError(f"Label does not match exactly one ledger row ({len(hit)}): {natural}")

    return int(hit["id"].iloc[0])


@dataclass
class AnomalyEvaluation:
    labelled: pd.DataFrame  # one row per labelled anomaly with every detector's verdict
    by_type: pd.DataFrame  # detected / missed per anomaly type and detector
    overall: pd.DataFrame  # TP / FN / FP / precision / recall per detector
    false_positives: pd.DataFrame  # flagged rows that are not labelled
    ranking: dict  # threshold-free numbers for the model score
    transactions: int

    def as_dict(self) -> dict:
        return {
            "transactions": self.transactions,
            "labelled": len(self.labelled),
            "overall": self.overall.to_dict(orient="records"),
            "by_type": self.by_type.to_dict(orient="records"),
            "ranking": self.ranking,
            "false_positive_breakdown": (
                self.false_positives.groupby(["type", "source"]).size().rename("count").reset_index().to_dict(orient="records")
                if len(self.false_positives)
                else []
            ),
        }


def evaluate_anomaly_detection(
    scored: pd.DataFrame, ledger: pd.DataFrame, products: pd.DataFrame, warehouses: pd.DataFrame, labels: dict
) -> AnomalyEvaluation:
    target_ids, related_ids, info = {}, set(), {}

    for label in labels["anomalies"]:
        row_id = _find(ledger, products, warehouses, label)
        target_ids[label["id"]] = row_id
        info[label["id"]] = label

        if label.get("related"):
            related_ids.add(_find(ledger, products, warehouses, label["related"]))

    frame = scored.set_index("id")
    ranked = frame["model_score"].rank(method="min", ascending=False)

    rows = []

    for label_id, row_id in target_ids.items():
        row, label = frame.loc[row_id], info[label_id]
        rows.append(
            {
                "label": label_id,
                "anomaly_type": label["anomalyType"],
                "sku": label["sku"],
                "occurred_at": label["occurredAt"],
                "quantity": label["quantity"],
                "expected_detection": label["expectedDetection"],
                "severity": label["severity"],
                "visible_in_demo": label["visibleInDemo"],
                "id": row_id,
                "rules": bool(row["rule_flag"]),
                "model": bool(row["model_flag"]),
                "combined": bool(row["flagged"]),
                "model_score": float(row["model_score"]),
                "model_rank": int(ranked.loc[row_id]),
                "rule_codes": ",".join(row["rule_codes"]) if isinstance(row["rule_codes"], list) else "",
            }
        )

    labelled = pd.DataFrame(rows)

    by_type = (
        labelled.groupby("anomaly_type")
        .agg(
            injected=("label", "count"),
            rules_detected=("rules", "sum"),
            model_detected=("model", "sum"),
            combined_detected=("combined", "sum"),
        )
        .reset_index()
    )

    for column in ("rules", "model", "combined"):
        by_type[f"{column}_missed"] = by_type["injected"] - by_type[f"{column}_detected"]

    ignored = set(target_ids.values()) | related_ids
    unlabeled_flags = frame[~frame.index.isin(ignored)]
    overall_rows, false_positives = [], []

    for name, column in DETECTORS.items():
        tp = int(labelled[name if name != "rules" else "rules"].sum())
        flagged_wrong = unlabeled_flags[unlabeled_flags[column]]
        fp = len(flagged_wrong)
        total = len(labelled)
        overall_rows.append(
            {
                "detector": name,
                "true_positives": tp,
                "missed": total - tp,
                "false_positives": fp,
                "precision": tp / (tp + fp) if tp + fp else float("nan"),
                "recall": tp / total,
            }
        )

        if name == "combined":
            false_positives = flagged_wrong

    # threshold-free quality of the model score; the 'related' originals are left out
    keep = ~frame.index.isin(related_ids)
    truth = frame.index[keep].isin(list(target_ids.values())).astype(int)
    score = frame.loc[keep, "model_score"].to_numpy()
    order = np.argsort(-score, kind="stable")
    ranking = {
        "average_precision": float(average_precision_score(truth, score)),
        "roc_auc": float(roc_auc_score(truth, score)),
        "baseline_average_precision": float(truth.mean()),  # what a random ranking would score
        "recall_at_k": {str(k): int(truth[order][:k].sum()) for k in TOP_K},
        "labelled": int(truth.sum()),
    }

    fp_table = false_positives.copy()

    if len(fp_table):
        fp_table = fp_table.merge(ledger[["id", "product_id", "warehouse_id"]], on=["id", "product_id", "warehouse_id"], how="left")
        fp_table = fp_table.merge(products[["id", "sku"]].rename(columns={"id": "product_id"}), on="product_id", how="left")

    return AnomalyEvaluation(
        labelled=labelled,
        by_type=by_type,
        overall=pd.DataFrame(overall_rows),
        false_positives=fp_table.reset_index(drop=True) if len(fp_table) else fp_table,
        ranking=ranking,
        transactions=len(frame),
    )
