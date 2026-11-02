"""Train, register and activate the anomaly model (AI-008, AI-013)."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from app.anomaly.model import CONTAMINATION, FOREST_PARAMS, AnomalyModel, fit_anomaly_model, score_ledger
from app.anomaly.rules import R1_MIN_SHARE, R1_MIN_UNITS, R2_MIN_UNITS, R2_MIN_Z, R4_MIN_MULTIPLE, R4_MIN_UNITS
from app.data.series import last_local_day
from app.registry import ModelRegistry
from app.versioning import library_versions, make_version

KIND = "anomaly"
FINGERPRINT_COLUMNS = ["id", "product_id", "warehouse_id", "type", "quantity", "balance_after", "reference_id", "created_at"]


@dataclass
class AnomalyTrainOutcome:
    version: str
    metrics: dict
    path: Path
    model: AnomalyModel
    scored: pd.DataFrame
    activated: bool


def ledger_fingerprint(ledger: pd.DataFrame) -> str:
    import hashlib

    ordered = ledger.sort_values("id", kind="stable")[FINGERPRINT_COLUMNS]
    hashed = pd.util.hash_pandas_object(ordered.astype({"created_at": "int64"}), index=False)

    return hashlib.sha256(hashed.to_numpy().tobytes()).hexdigest()


def training_config(random_state: int, tz_offset_hours: int, contamination: float) -> dict:
    return {
        "contamination": contamination,
        "forest": FOREST_PARAMS,
        "random_state": random_state,
        "tz_offset_hours": tz_offset_hours,
        "rules": {
            "R1": {"min_units": R1_MIN_UNITS, "min_share": R1_MIN_SHARE},
            "R2": {"min_z": R2_MIN_Z, "min_units": R2_MIN_UNITS},
            "R3": {"business_hours_local": "08:00-17:00"},
            "R4": {"min_units": R4_MIN_UNITS, "min_multiple": R4_MIN_MULTIPLE},
        },
    }


def train_anomaly(
    ledger: pd.DataFrame,
    registry: ModelRegistry,
    random_state: int = 0,
    tz_offset_hours: int = 6,
    contamination: float = CONTAMINATION,
    activate: bool = True,
) -> AnomalyTrainOutcome:
    model = fit_anomaly_model(ledger, tz_offset_hours, random_state, contamination)
    scored = score_ledger(model, ledger)
    as_of = last_local_day(ledger, tz_offset_hours)
    config = training_config(random_state, tz_offset_hours, contamination)

    version = make_version(KIND, as_of, {"data": ledger_fingerprint(ledger), "config": config})
    metrics = {
        "version": version,
        "as_of": as_of,
        "transactions": len(scored),
        "flagged": int(scored["flagged"].sum()),
        "flagged_by_rule": int(scored["rule_flag"].sum()),
        "flagged_by_model": int(scored["model_flag"].sum()),
        "flagged_by_both": int((scored["source"] == "BOTH").sum()),
        "model_flag_threshold": model.flag_threshold,
        "note": "Labels are never used for training or thresholds; evaluate against them separately.",
    }
    metadata = {
        "kind": KIND,
        "version": version,
        "as_of": as_of,
        "config": config,
        "libraries": library_versions(),
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }

    path = registry.save(KIND, version, model, metrics, metadata)

    if activate:
        registry.activate(KIND, version)

    return AnomalyTrainOutcome(version, metrics, path, model, scored, activate)
