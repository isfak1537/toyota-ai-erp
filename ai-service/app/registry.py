"""Model registry on disk (gitignored): joblib artifact + metrics JSON + metadata.

    models/<kind>/<version>/{model.joblib, metrics.json, metadata.json}
    models/<kind>/ACTIVE.json          {"version": "..."}

Activation swaps the pointer file atomically (write a temp file, os.replace), so
a retrain never interrupts a service that is serving the previous model
(AI-013): readers see either the old or the new version, never a partial file.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import joblib

from app.versioning import to_jsonable


class RegistryError(RuntimeError):
    pass


class ModelRegistry:
    def __init__(self, base_dir: str | Path):
        self.base_dir = Path(base_dir)

    def _kind_dir(self, kind: str) -> Path:
        return self.base_dir / kind

    def save(self, kind: str, version: str, artifact: Any, metrics: dict, metadata: dict) -> Path:
        target = self._kind_dir(kind) / version
        target.parent.mkdir(parents=True, exist_ok=True)

        staging = Path(tempfile.mkdtemp(prefix=f"{version}.tmp-", dir=target.parent))

        try:
            joblib.dump(artifact, staging / "model.joblib")
            (staging / "metrics.json").write_text(json.dumps(to_jsonable(metrics), indent=2, sort_keys=True) + "\n")
            (staging / "metadata.json").write_text(json.dumps(to_jsonable(metadata), indent=2, sort_keys=True) + "\n")

            if target.exists():
                shutil.rmtree(target)  # same version = same inputs: replace, never mix files

            os.replace(staging, target)
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

        return target

    def activate(self, kind: str, version: str) -> None:
        if not (self._kind_dir(kind) / version / "model.joblib").exists():
            raise RegistryError(f"{kind} version {version} is not in the registry")

        pointer = self._kind_dir(kind) / "ACTIVE.json"
        handle, temp = tempfile.mkstemp(prefix="ACTIVE.", suffix=".tmp", dir=self._kind_dir(kind))

        try:
            with os.fdopen(handle, "w") as stream:
                stream.write(json.dumps({"version": version}))
                stream.flush()
                os.fsync(stream.fileno())

            os.replace(temp, pointer)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    def active_version(self, kind: str) -> str | None:
        pointer = self._kind_dir(kind) / "ACTIVE.json"

        if not pointer.exists():
            return None

        return json.loads(pointer.read_text())["version"]

    def versions(self, kind: str) -> list[str]:
        directory = self._kind_dir(kind)

        if not directory.exists():
            return []

        return sorted(
            path.name for path in directory.iterdir() if path.is_dir() and (path / "model.joblib").exists()
        )

    def load(self, kind: str, version: str | None = None) -> tuple[Any, dict, dict]:
        version = version or self.active_version(kind)

        if version is None:
            raise RegistryError(f"No active {kind} model; train one first")

        directory = self._kind_dir(kind) / version

        if not (directory / "model.joblib").exists():
            raise RegistryError(f"{kind} version {version} is not in the registry")

        return (
            joblib.load(directory / "model.joblib"),
            json.loads((directory / "metrics.json").read_text()),
            json.loads((directory / "metadata.json").read_text()),
        )
