"""Deterministic model versions (NFR-016).

A version is derived from what the model was trained on and how, never from the
clock: the same data and configuration always give the same version, so a
retrain that changes nothing is recognisable as such.
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import sys
from typing import Any, Mapping

import numpy as np
import pandas as pd
import sklearn


def fingerprint_series(series: Mapping[tuple[int, int], pd.Series]) -> str:
    """Hash of every series: key, first/last day and the exact values."""
    digest = hashlib.sha256()

    for key in sorted(series):
        values = series[key]
        digest.update(f"{key[0]}:{key[1]}:{values.index[0].date()}:{values.index[-1].date()}:".encode())
        digest.update(np.ascontiguousarray(values.to_numpy(dtype="float64")).tobytes())

    return digest.hexdigest()


def library_versions() -> dict[str, str]:
    return {
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit_learn": sklearn.__version__,
        "platform": platform.machine(),
    }


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))


def make_version(kind: str, as_of: pd.Timestamp, payload: Mapping[str, Any]) -> str:
    """`<kind>-<as_of yyyymmdd>-<8 hex>`; the hash covers the payload and library versions."""
    digest = hashlib.sha256(canonical({"payload": payload, "libraries": library_versions()}).encode()).hexdigest()

    return f"{kind}-{pd.Timestamp(as_of):%Y%m%d}-{digest[:8]}"


def to_jsonable(value: Any) -> Any:
    """Plain JSON types; NaN and infinity become null."""
    if isinstance(value, Mapping):
        return {str(key): to_jsonable(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]

    if isinstance(value, (np.floating, float)):
        number = float(value)

        return number if math.isfinite(number) else None

    if isinstance(value, (np.integer,)):
        return int(value)

    if isinstance(value, (np.bool_,)):
        return bool(value)

    if isinstance(value, np.ndarray):
        return to_jsonable(value.tolist())

    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")

    return value
