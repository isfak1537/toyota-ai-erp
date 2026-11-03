"""Measures what the AI service needs to be deployed on a serverless or small-instance host.

    .venv/bin/python scripts/measure_bundle.py [--python 3.13] [--no-install]

1. Size: installs the runtime requirements (requirements.txt) for Linux x86-64 into a temporary folder, the way a
   Linux build host would, and reports the unpacked size, the size without bytecode and test folders, and the zip size.
   Compare the numbers with the host's bundle limit (Vercel Python functions: 500 MB uncompressed, checked 3 Nov 2026).
2. Memory: runs the service in-process on the committed fixtures (train both models, forecast, score) in a fresh
   process and reports its peak resident memory. Compare with the host's RAM (Vercel Hobby: 2 GB; Render free: 512 MB).
   The peak is measured on THIS machine's OS; Linux numbers are usually similar, so treat it as an estimate.
3. Timing: import time and the time to train from scratch, which matter for cold starts.

Nothing is written outside a temporary folder, and no secret is used.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MB = 1024 * 1024


def folder_size(path: Path, skip=lambda p: False) -> tuple[int, int]:
    total, files = 0, 0

    for item in path.rglob("*"):
        if item.is_file() and not skip(item):
            total += item.stat().st_size
            files += 1

    return total, files


def lean(path: Path) -> bool:
    """True for what a size-conscious build would drop: bytecode, test suites, type stubs."""
    parts = set(path.parts)

    return "__pycache__" in parts or path.suffix == ".pyc" or "tests" in parts or "test" in parts or path.suffix == ".pyi"


def measure_install(python_version: str) -> dict:
    target = Path(tempfile.mkdtemp(prefix="bundle-"))

    try:
        command = [
            sys.executable, "-m", "pip", "install", "--quiet", "--no-cache-dir", "--target", str(target),
            "--only-binary=:all:", "--implementation", "cp", "--python-version", python_version,
            "--platform", "manylinux2014_x86_64", "--platform", "manylinux_2_28_x86_64", "--platform", "manylinux_2_17_x86_64",
            "-r", str(ROOT / "requirements.txt"),
        ]
        subprocess.run(command, check=True)
        full, files = folder_size(target)
        trimmed, trimmed_files = folder_size(target, lean)
        archive = target.parent / "bundle-test.zip"

        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in target.rglob("*"):
                if item.is_file() and not lean(item):
                    zf.write(item, item.relative_to(target))

        zipped = archive.stat().st_size
        archive.unlink()
        biggest = sorted(((folder_size(p)[0], p.name) for p in target.iterdir() if p.is_dir() and not p.name.endswith(".dist-info")), reverse=True)[:6]
        app_bytes = sum(folder_size(ROOT / name)[0] for name in ("app",))

        return {
            "python": python_version,
            "platform": "linux x86-64 (manylinux wheels)",
            "dependencies_mb": round(full / MB, 1),
            "dependencies_files": files,
            "dependencies_without_bytecode_and_tests_mb": round(trimmed / MB, 1),
            "dependencies_files_trimmed": trimmed_files,
            "zip_of_trimmed_mb": round(zipped / MB, 1),
            "app_code_mb": round(app_bytes / MB, 2),
            "largest_packages_mb": [(name, round(size / MB, 1)) for size, name in biggest],
        }
    finally:
        shutil.rmtree(target, ignore_errors=True)


CHILD = r"""
import json, resource, sys, time
t0 = time.time()
sys.path.insert(0, ".")
from fastapi.testclient import TestClient
from app.config import Settings
from app.data.sources import CsvSource
from app.main import create_app
from app.registry import ModelRegistry
import tempfile
imported = time.time() - t0
folder = tempfile.mkdtemp()
settings = Settings.from_env({"AI_SERVICE_SECRET": "measure-secret-0123456789", "AI_MODEL_DIR": folder})
client = TestClient(create_app(settings, source=CsvSource("tests/fixtures"), registry=ModelRegistry(settings.model_dir)))
h = {"X-AI-Service-Secret": "measure-secret-0123456789"}
rss = lambda: resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == "darwin" else 1024)
after_import = rss()
t1 = time.time(); client.post("/train", json={}, headers=h); trained = time.time() - t1; after_train = rss()
series = [{"productId": 2, "warehouseId": 2}, {"productId": 7, "warehouseId": 1}]
t2 = time.time(); client.post("/forecast", json={"series": series, "horizonDays": 30}, headers=h); forecast = time.time() - t2
t3 = time.time(); client.post("/anomalies/score", json={"from": "2026-10-10T00:00:00Z", "to": "2026-11-02T00:00:00Z"}, headers=h); score = time.time() - t3
print(json.dumps({"import_s": round(imported, 1), "train_s": round(trained, 1), "forecast_s": round(forecast, 2), "score_s": round(score, 2),
  "rss_after_import_mb": round(after_import), "rss_after_train_mb": round(after_train), "peak_rss_mb": round(rss())}))
"""


def measure_memory() -> dict:
    result = subprocess.run([sys.executable, "-c", CHILD], cwd=ROOT, check=True, capture_output=True, text=True)

    return json.loads(result.stdout.strip().splitlines()[-1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", default="3.13", help="target Python minor version for the wheels")
    parser.add_argument("--no-install", action="store_true", help="skip the download-heavy size measurement")
    args = parser.parse_args()

    report = {"memory_and_timing": measure_memory()}

    if not args.no_install:
        report["bundle"] = measure_install(args.python)

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    main()
