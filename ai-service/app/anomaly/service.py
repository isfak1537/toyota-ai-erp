"""Serving anomaly scores from the active model (AI-008, NFR-013)."""

from __future__ import annotations

import datetime as dt
from typing import Sequence

import pandas as pd

from app.anomaly.model import score_ledger
from app.anomaly.training import KIND, AnomalyTrainOutcome, train_anomaly
from app.data.asof import as_of_day, end_of_local_day_utc
from app.data.sources import LedgerSource
from app.errors import ServiceError
from app.registry import ModelRegistry, RegistryError

MAX_TARGETS = 20_000


def _iso(value: pd.Timestamp) -> str:
    return pd.Timestamp(value).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class AnomalyService:
    def __init__(self, source: LedgerSource, registry: ModelRegistry, tz_offset_hours: int = 6):
        self.source = source
        self.registry = registry
        self.tz_offset_hours = tz_offset_hours
        self._cache: tuple[str, object] | None = None

    def active_version(self) -> str | None:
        return self.registry.active_version(KIND)

    def _active(self):
        version = self.registry.active_version(KIND)

        if version is None:
            raise ServiceError("No active anomaly model; POST /train first", 503)

        if self._cache is None or self._cache[0] != version:
            try:
                model, _, _ = self.registry.load(KIND, version)
            except RegistryError as error:
                raise ServiceError(str(error), 503) from error

            self._cache = (version, model)

        return version, self._cache[1]

    def train(self, as_of: dt.date | None = None) -> AnomalyTrainOutcome:
        day = as_of_day(self.source, self.tz_offset_hours, as_of)
        ledger = self.source.ledger(created_to=end_of_local_day_utc(day, self.tz_offset_hours))

        if ledger.empty:
            raise ServiceError("There are no transactions to train on", 409)

        return train_anomaly(ledger, self.registry, tz_offset_hours=self.tz_offset_hours)

    def score(
        self,
        transaction_ids: Sequence[int] | None,
        created_from: pd.Timestamp | None,
        created_to: pd.Timestamp | None,
        include_all: bool = False,
    ) -> dict:
        version, model = self._active()

        if transaction_ids is not None:
            targets = self.source.ledger(ids=transaction_ids)
            not_found = sorted(set(transaction_ids) - set(targets["id"]))
        else:
            targets = self.source.ledger(created_from=created_from, created_to=created_to)
            not_found = []

        if len(targets) > MAX_TARGETS:
            raise ServiceError(f"That selects {len(targets)} transactions; the limit is {MAX_TARGETS}", 400)

        if targets.empty:
            return {"modelVersion": version, "scored": 0, "flagged": 0, "notFoundIds": not_found, "flags": []}

        keys = sorted({(int(p), int(w)) for p, w in zip(targets["product_id"], targets["warehouse_id"])})
        context = self.source.ledger(series=keys)  # the earlier movements of each series, for gaps and repeats
        scored = score_ledger(model, context)
        scored = scored[scored["id"].isin(set(targets["id"]))]
        shown = scored if include_all else scored[scored["flagged"]]
        shown = shown.sort_values(["score", "created_at"], ascending=[False, True], kind="stable")

        return {
            "modelVersion": version,
            "scored": int(len(scored)),
            "flagged": int(scored["flagged"].sum()),
            "notFoundIds": not_found,
            "flags": [
                {
                    "inventoryTransactionId": int(row["id"]),
                    "productId": int(row["product_id"]),
                    "warehouseId": int(row["warehouse_id"]),
                    "type": row["type"],
                    "quantity": int(row["quantity"]),
                    "occurredAt": _iso(row["created_at"]),
                    "flagged": bool(row["flagged"]),
                    "score": float(row["score"]),
                    "modelScore": float(row["model_score"]),
                    "source": row["source"] or None,
                    "ruleCodes": list(row["rule_codes"]) if isinstance(row["rule_codes"], list) else [],
                    "reason": row["reason"] if isinstance(row["reason"], str) else None,
                }
                for _, row in shown.iterrows()
            ],
        }
