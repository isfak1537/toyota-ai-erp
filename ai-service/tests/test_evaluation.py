import json
import math

import numpy as np
import pandas as pd
import pytest

from app.forecasting.evaluate import (
    BASELINE,
    ML,
    choose,
    estimate_sigma,
    evaluate_forecasting,
    seasonal_naive,
)
from app.versioning import to_jsonable


END = "2026-09-27"


def make_series(values, end=END):
    """A series that ends on `end` (all series of one evaluation end on the same day)."""
    return pd.Series(values, index=pd.date_range(end=end, periods=len(values), freq="D"), dtype="float64")


def synthetic(seed=0, days=120, count=8):
    """Weekday-patterned Poisson series of different volumes, all ending on the same day."""
    rng = np.random.default_rng(seed)
    factor = np.array([1.0, 1.0, 1.0, 1.0, 0.45, 0.5, 1.0])
    dow = pd.date_range(end=END, periods=days).day_of_week
    series = {}

    for k in range(count):
        series[(k + 1, 1)] = make_series(rng.poisson(factor[dow] * (2 + 2.5 * k)).astype("float64"))

    return series


@pytest.fixture(scope="module")
def evaluation():
    data = synthetic()
    data[(98, 1)] = make_series(np.random.default_rng(1).poisson(3, 40).astype("float64"))  # 40 days
    data[(99, 1)] = make_series(np.ones(10))  # 10 days: cannot be evaluated

    return data, evaluate_forecasting(data)


# ---- selection (AI-003) -------------------------------------------------------


def test_the_lower_holdout_mae_wins_and_ties_go_to_the_baseline():
    assert choose(2.0, 1.5) == ML
    assert choose(1.5, 2.0) == BASELINE
    assert choose(1.5, 1.5) == BASELINE


@pytest.mark.parametrize("ml", [None, float("nan")])
def test_a_missing_ml_score_falls_back_to_the_baseline(ml):
    assert choose(2.0, ml) == BASELINE
    assert choose(float("nan"), 1.0) == BASELINE


# ---- sigma ----------------------------------------------------------------------


def test_sigma_is_the_holdout_rmse_when_it_exceeds_the_poisson_spread():
    actual, forecast = np.array([0.0, 10.0]), np.array([5.0, 5.0])  # residuals -5, +5

    assert estimate_sigma(actual, forecast) == pytest.approx(5.0)  # > sqrt(5) = 2.236


def test_sigma_never_drops_below_the_poisson_spread_of_the_forecast():
    actual, forecast = np.array([1.0, 3.0]), np.array([2.0, 2.0])  # rmse 1.0

    assert estimate_sigma(actual, forecast) == pytest.approx(math.sqrt(2.0))


def test_a_dead_series_has_zero_sigma():
    assert estimate_sigma(np.zeros(14), np.zeros(14)) == 0.0


# ---- the seasonal-naive reference ---------------------------------------------------


def test_seasonal_naive_repeats_the_same_weekday_of_the_last_week():
    train = np.arange(1.0, 15.0)  # 14 days, origin = day 14 (value 14)

    forecast = seasonal_naive(train, 14)

    # h=1..7 -> the values 7 days earlier (8..14); h=8..14 repeat them again
    assert list(forecast[:7]) == [8, 9, 10, 11, 12, 13, 14]
    assert list(forecast[7:]) == [8, 9, 10, 11, 12, 13, 14]


# ---- the evaluation -----------------------------------------------------------------


def test_series_without_enough_history_are_skipped_or_fall_back(evaluation):
    data, result = evaluation

    assert (99, 1) in result.skipped
    assert (99, 1) not in result.per_series
    short = result.per_series[(98, 1)]  # 26 training days: no ML forecast possible
    assert short.ml is None and short.mae_ml is None
    assert short.selected == BASELINE and short.nested_selected == BASELINE
    assert result.ml_series == len(result.per_series) - 1


def test_every_series_is_scored_on_exactly_the_last_14_days(evaluation):
    data, result = evaluation

    assert result.holdout_end == pd.Timestamp("2026-09-27")
    assert result.holdout_start == pd.Timestamp("2026-09-14")

    for key, ev in result.per_series.items():
        assert len(ev.actual) == len(ev.baseline) == len(ev.seasonal) == 14
        assert np.array_equal(ev.actual, data[key].iloc[-14:].to_numpy())
        assert ev.train_days == len(data[key]) - 14


def test_selected_is_never_worse_than_either_model_by_construction(evaluation):
    _, result = evaluation
    s = result.summaries

    assert s["selected"].macro_mae <= s["baseline"].macro_mae + 1e-12
    assert s["selected"].macro_mae <= s["ml"].macro_mae + 1e-12
    assert s["baseline"].series == s["ml"].series == s["selected"].series == len(result.per_series)


def test_the_baseline_window_is_one_of_the_candidates_and_reported_for_both(evaluation):
    _, result = evaluation

    for ev in result.per_series.values():
        assert ev.baseline_window in (7, 14)
        assert ev.mae_baseline == pytest.approx(ev.mae_ma7 if ev.baseline_window == 7 else ev.mae_ma14)


def test_sigma_comes_from_the_selected_models_holdout_residuals(evaluation):
    _, result = evaluation

    for ev in result.per_series.values():
        assert ev.sigma == pytest.approx(estimate_sigma(ev.actual, ev.selected_forecast))
        assert ev.sigma >= math.sqrt(float(np.mean(ev.selected_forecast))) - 1e-12


def test_the_holdout_cannot_influence_the_forecasts_it_is_scored_against(evaluation):
    data, result = evaluation
    altered = {key: values.copy() for key, values in data.items()}

    for values in altered.values():
        values.iloc[-14:] = 7777.0

    other = evaluate_forecasting(altered)

    for key, ev in result.per_series.items():
        twin = other.per_series[key]
        assert twin.baseline_window == ev.baseline_window
        assert np.array_equal(twin.baseline, ev.baseline)
        assert (twin.ml is None) == (ev.ml is None)
        if ev.ml is not None:
            assert np.array_equal(twin.ml, ev.ml)
        assert twin.mae_baseline != ev.mae_baseline  # only the scoring changed


def test_the_nested_choice_is_made_without_looking_at_the_final_holdout(evaluation):
    data, result = evaluation
    altered = {key: values.copy() for key, values in data.items()}

    for values in altered.values():
        values.iloc[-14:] = 7777.0

    other = evaluate_forecasting(altered)

    for key, ev in result.per_series.items():
        assert other.per_series[key].nested_selected == ev.nested_selected

    assert other.summaries["nested_selected"].macro_mae != result.summaries["nested_selected"].macro_mae


def test_the_nested_estimate_needs_two_full_windows_of_history(evaluation):
    _, result = evaluation

    assert result.per_series[(98, 1)].nested_selected == BASELINE  # only 26 days before the holdout


def test_metrics_are_json_ready_and_complete(evaluation):
    _, result = evaluation
    metrics = to_jsonable(result.metrics())

    text = json.dumps(metrics, allow_nan=False)  # raises on NaN / infinity
    parsed = json.loads(text)

    assert set(parsed["overall"]) == {"baseline", "ml", "selected", "nested_selected", "seasonal_naive"}
    assert parsed["holdout_days"] == 14
    assert parsed["series_evaluated"] == len(result.per_series)
    assert parsed["selected_ml"] + parsed["selected_baseline"] == parsed["series_evaluated"]
    assert parsed["per_series"]["1:1"]["selected"] in ("BASELINE", "ML")
    assert parsed["notes"]


def test_series_that_end_on_different_days_are_rejected_loudly():
    data = synthetic(count=2)
    data[(5, 1)] = make_series(np.ones(60), end="2026-09-20")

    with pytest.raises(ValueError, match="same day"):
        evaluate_forecasting(data)


def test_evaluating_nothing_is_an_error():
    with pytest.raises(ValueError):
        evaluate_forecasting({})

    with pytest.raises(ValueError, match="enough history"):
        evaluate_forecasting({(1, 1): make_series(np.ones(10))})


def test_evaluation_is_deterministic():
    data = synthetic(seed=3, count=4)

    a = evaluate_forecasting(data).metrics()
    b = evaluate_forecasting(data).metrics()

    assert to_jsonable(a) == to_jsonable(b)
