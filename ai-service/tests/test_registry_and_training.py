import json
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.data.series import daily_demand, series_map
from app.data.sources import CsvSource
from app.forecasting.training import KIND, train_forecasting
from app.registry import ModelRegistry, RegistryError
from app.versioning import fingerprint_series, make_version, to_jsonable

FIXTURES = Path(__file__).parent / "fixtures"
ROOT = Path(__file__).parent.parent


def make_series(values, end="2026-09-27"):
    return pd.Series(values, index=pd.date_range(end=end, periods=len(values), freq="D"), dtype="float64")


def small_data(seed=0):
    rng = np.random.default_rng(seed)
    dow = pd.date_range(end="2026-09-27", periods=90).day_of_week
    factor = np.array([1.0, 1.0, 1.0, 1.0, 0.45, 0.5, 1.0])

    return {(k, 1): make_series(rng.poisson(factor[dow] * (2 + 3 * k)).astype("float64")) for k in range(1, 5)}


@pytest.fixture(scope="module")
def fixture_series():
    ledger = CsvSource(FIXTURES).ledger()

    return series_map(daily_demand(ledger, tz_offset_hours=6))


# ---- versioning ---------------------------------------------------------------------


def test_a_version_names_the_kind_the_as_of_day_and_a_hash():
    version = make_version("forecast", pd.Timestamp("2026-11-01"), {"a": 1})

    assert version.startswith("forecast-20261101-")
    assert len(version.split("-")[-1]) == 8
    int(version.split("-")[-1], 16)


def test_the_same_inputs_always_give_the_same_version():
    a = make_version("forecast", pd.Timestamp("2026-11-01"), {"data": "x", "config": {"b": 2, "a": 1}})
    b = make_version("forecast", pd.Timestamp("2026-11-01"), {"config": {"a": 1, "b": 2}, "data": "x"})

    assert a == b


def test_any_change_in_data_or_config_changes_the_version():
    base = make_version("forecast", pd.Timestamp("2026-11-01"), {"data": "x", "config": {"seed": 0}})

    assert make_version("forecast", pd.Timestamp("2026-11-01"), {"data": "y", "config": {"seed": 0}}) != base
    assert make_version("forecast", pd.Timestamp("2026-11-01"), {"data": "x", "config": {"seed": 1}}) != base
    assert make_version("anomaly", pd.Timestamp("2026-11-01"), {"data": "x", "config": {"seed": 0}}) != base


def test_the_fingerprint_notices_a_single_changed_value_and_ignores_key_order():
    data = small_data()
    reordered = dict(reversed(list(data.items())))
    changed = {key: values.copy() for key, values in data.items()}
    changed[(2, 1)].iloc[10] += 1.0

    assert fingerprint_series(data) == fingerprint_series(reordered)
    assert fingerprint_series(data) != fingerprint_series(changed)


def test_nan_and_infinity_become_null_in_json():
    converted = to_jsonable({"a": float("nan"), "b": [np.float64("inf"), np.int64(3)], "c": pd.Timestamp("2026-11-01")})

    assert json.dumps(converted, allow_nan=False) == '{"a": null, "b": [null, 3], "c": "2026-11-01"}'


# ---- registry -----------------------------------------------------------------------


def test_save_and_load_round_trip(tmp_path):
    registry = ModelRegistry(tmp_path)
    registry.save("forecast", "v1", {"answer": 42}, {"mae": float("nan"), "n": 3}, {"kind": "forecast"})

    artifact, metrics, metadata = registry.load("forecast", "v1")

    assert artifact == {"answer": 42}
    assert metrics == {"mae": None, "n": 3}
    assert metadata == {"kind": "forecast"}
    assert sorted(path.name for path in (tmp_path / "forecast" / "v1").iterdir()) == [
        "metadata.json",
        "metrics.json",
        "model.joblib",
    ]


def test_nothing_is_active_until_a_version_is_activated(tmp_path):
    registry = ModelRegistry(tmp_path)
    registry.save("forecast", "v1", 1, {}, {})

    assert registry.active_version("forecast") is None
    with pytest.raises(RegistryError, match="No active forecast model"):
        registry.load("forecast")

    registry.activate("forecast", "v1")

    assert registry.active_version("forecast") == "v1"
    assert registry.load("forecast")[0] == 1


def test_activating_a_missing_version_is_refused_and_changes_nothing(tmp_path):
    registry = ModelRegistry(tmp_path)
    registry.save("forecast", "v1", 1, {}, {})
    registry.activate("forecast", "v1")

    with pytest.raises(RegistryError, match="not in the registry"):
        registry.activate("forecast", "ghost")

    assert registry.active_version("forecast") == "v1"


def test_a_new_version_does_not_disturb_the_previous_one(tmp_path):
    registry = ModelRegistry(tmp_path)
    registry.save("forecast", "v1", "old", {}, {})
    registry.activate("forecast", "v1")
    serving = registry.load("forecast")[0]  # a service already holds the old model

    registry.save("forecast", "v2", "new", {}, {})

    assert registry.active_version("forecast") == "v1"  # saving alone never switches
    assert registry.load("forecast")[0] == "old"
    registry.activate("forecast", "v2")
    assert registry.load("forecast")[0] == "new"
    assert serving == "old"
    assert registry.versions("forecast") == ["v1", "v2"]
    assert registry.load("forecast", "v1")[0] == "old"  # still loadable, e.g. for rollback


def test_saving_the_same_version_again_replaces_it_cleanly_and_leaves_no_temp_files(tmp_path):
    registry = ModelRegistry(tmp_path)
    registry.save("forecast", "v1", "first", {"n": 1}, {})
    registry.save("forecast", "v1", "second", {"n": 2}, {})

    assert registry.load("forecast", "v1")[:2] == ("second", {"n": 2})
    assert [path.name for path in (tmp_path / "forecast").iterdir()] == ["v1"]


def test_loading_an_unknown_version_names_it(tmp_path):
    with pytest.raises(RegistryError, match="v9"):
        ModelRegistry(tmp_path).load("forecast", "v9")


def test_the_active_pointer_is_never_seen_half_written(tmp_path):
    registry = ModelRegistry(tmp_path)
    registry.save("forecast", "a", 1, {}, {})
    registry.save("forecast", "b", 2, {}, {})
    registry.activate("forecast", "a")
    stop = threading.Event()
    seen, errors = set(), []

    def reader():
        while not stop.is_set():
            try:
                seen.add(registry.active_version("forecast"))
            except Exception as error:  # a partial file would raise here
                errors.append(error)

    threads = [threading.Thread(target=reader) for _ in range(3)]
    [t.start() for t in threads]

    for i in range(300):
        registry.activate("forecast", "ab"[i % 2])

    stop.set()
    [t.join() for t in threads]

    assert errors == []
    assert seen <= {"a", "b"}


# ---- training ---------------------------------------------------------------------------


def test_training_registers_and_activates_a_model_that_loads_back(tmp_path):
    registry = ModelRegistry(tmp_path)
    data = small_data()

    outcome = train_forecasting(data, registry)

    assert registry.active_version(KIND) == outcome.version
    artifact, metrics, metadata = registry.load(KIND)
    assert metrics["version"] == outcome.version == metadata["version"]
    assert set(artifact["series"]) == set(data)
    assert artifact["as_of"] == pd.Timestamp("2026-09-27")
    assert artifact["series"][(1, 1)]["selected"] in ("BASELINE", "ML")
    assert artifact["series"][(1, 1)]["sigma"] > 0
    assert metadata["libraries"]["python"] and metadata["trained_at"]
    json.dumps(metrics, allow_nan=False)  # strictly valid JSON


def test_retraining_on_the_same_data_gives_the_same_version_and_predictions(tmp_path):
    data = small_data()
    first = train_forecasting(data, ModelRegistry(tmp_path / "a"))
    second = train_forecasting(data, ModelRegistry(tmp_path / "b"))

    assert first.version == second.version
    assert to_jsonable(first.metrics) == to_jsonable(second.metrics)

    a = ModelRegistry(tmp_path / "a").load(KIND)[0]["model"].predict(data[(1, 1)], 14)
    b = ModelRegistry(tmp_path / "b").load(KIND)[0]["model"].predict(data[(1, 1)], 14)
    assert np.array_equal(a, b)


def test_changed_data_gives_a_new_version(tmp_path):
    data = small_data()
    changed = {key: values.copy() for key, values in data.items()}
    changed[(1, 1)].iloc[-3] += 5

    assert train_forecasting(data, ModelRegistry(tmp_path / "a")).version != train_forecasting(
        changed, ModelRegistry(tmp_path / "b")
    ).version


def test_training_without_activation_leaves_the_current_model_serving(tmp_path):
    registry = ModelRegistry(tmp_path)
    first = train_forecasting(small_data(0), registry)

    train_forecasting(small_data(1), registry, activate=False)

    assert registry.active_version(KIND) == first.version
    assert len(registry.versions(KIND)) == 2


def test_series_too_young_to_evaluate_still_get_a_baseline_entry(tmp_path):
    data = small_data()
    data[(77, 1)] = make_series(np.ones(10))

    artifact = train_forecasting(data, ModelRegistry(tmp_path)).evaluation

    registry_artifact = ModelRegistry(tmp_path).load(KIND)[0]
    entry = registry_artifact["series"][(77, 1)]
    assert entry["selected"] == "BASELINE" and entry["evaluated"] is False and entry["sigma"] > 0
    assert (77, 1) in artifact.skipped


# ---- the synthetic fixture, end to end, in a separate process ---------------------------------


def test_training_on_the_fixtures_is_identical_across_separate_processes(tmp_path, fixture_series):
    here = train_forecasting(fixture_series, ModelRegistry(tmp_path / "here"))

    script = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "from app.data.series import daily_demand, series_map\n"
        "from app.data.sources import CsvSource\n"
        "from app.forecasting.training import train_forecasting\n"
        "from app.registry import ModelRegistry\n"
        "ledger = CsvSource(Path('tests/fixtures')).ledger()\n"
        "series = series_map(daily_demand(ledger, tz_offset_hours=6))\n"
        "outcome = train_forecasting(series, ModelRegistry(sys.argv[1]))\n"
        "print(outcome.version)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path / "there")], cwd=ROOT, capture_output=True, text=True, check=True
    )

    assert result.stdout.strip() == here.version
    here_metrics = (tmp_path / "here" / KIND / here.version / "metrics.json").read_bytes()
    there_metrics = (tmp_path / "there" / KIND / here.version / "metrics.json").read_bytes()
    assert here_metrics == there_metrics


def test_the_fixture_evaluation_covers_every_series_and_is_internally_consistent(fixture_series):
    from app.forecasting.evaluate import evaluate_forecasting

    result = evaluate_forecasting(fixture_series)

    assert len(result.per_series) == 24 and result.skipped == []
    assert result.ml_series == 24
    s = result.summaries
    assert s["per_series_selection"].macro_mae <= min(s["baseline"].macro_mae, s["ml"].macro_mae) + 1e-12  # the old rule, by construction
    assert s["policy"].macro_mae == pytest.approx(s["ml"].macro_mae)  # every fixture series has an ML forecast
    assert s["policy"].macro_mae < s["baseline"].macro_mae  # on this data ML is better than the baseline overall
    assert s["per_series_selection_nested"].macro_mae > s["policy"].macro_mae  # the evidence behind replacing the old rule
    assert all(np.isfinite(ev.sigma) and ev.sigma >= 0 for ev in result.per_series.values())
