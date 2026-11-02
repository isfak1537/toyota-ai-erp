import numpy as np
import pandas as pd
import pytest

from app.forecasting.baseline import moving_average_forecast
from app.forecasting.features import (
    FEATURE_NAMES,
    MIN_HISTORY,
    build_samples,
    forecast_frame,
    horizon_features,
    origin_features,
    same_weekday_values,
    truncate,
)
from app.forecasting.metrics import mae
from app.forecasting.model import GlobalDemandModel


def make_series(values, start="2026-08-03"):  # 2026-08-03 is a Monday
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="D"), dtype="float64")


# ---- origin features: hand-computed ----------------------------------------


def test_origin_features_are_plain_statistics_of_the_recent_past():
    values = np.arange(1.0, 41.0)  # 1..40, origin = last day

    f = origin_features(values, origin=39)

    assert f["mean_7"] == pytest.approx(np.mean(range(34, 41)))
    assert f["mean_14"] == pytest.approx(np.mean(range(27, 41)))
    assert f["mean_28"] == pytest.approx(np.mean(range(13, 41)))
    assert f["last_value"] == 40.0
    assert f["std_14"] == pytest.approx(np.std(range(27, 41)))
    assert f["zero_share_14"] == 0.0
    assert f["rel_slope_28"] == pytest.approx(1.0 / np.mean(range(13, 41)))  # slope 1 per day
    assert f["trend_ratio"] == pytest.approx(f["mean_7"] / f["mean_28"])
    assert f["level_log"] == pytest.approx(np.log1p(f["mean_28"]))


def test_zero_share_counts_quiet_days():
    values = np.array([0.0, 3.0] * 20)

    assert origin_features(values, origin=39)["zero_share_14"] == pytest.approx(0.5)


# ---- no leakage --------------------------------------------------------------


def test_origin_features_ignore_everything_after_the_origin():
    rng = np.random.default_rng(1)
    values = rng.poisson(4, 60).astype("float64")
    corrupted = values.copy()
    corrupted[40:] = 9999.0

    assert origin_features(values, origin=39) == origin_features(corrupted, origin=39)


def test_horizon_features_ignore_everything_after_the_origin():
    series = make_series(np.random.default_rng(2).poisson(4, 60).astype("float64"))
    corrupted = series.copy()
    corrupted.iloc[40:] = 9999.0

    for h in (1, 3, 7, 10, 14, 30):
        a = horizon_features(series.to_numpy(), series.index, 39, h, origin_features(series.to_numpy(), 39))
        b = horizon_features(corrupted.to_numpy(), corrupted.index, 39, h, origin_features(corrupted.to_numpy(), 39))
        assert a == b


def test_same_weekday_values_never_reach_past_the_origin():
    values = np.arange(100.0)
    # origin on a Wednesday (dow 2); asking for next Wednesday must still use PAST Wednesdays
    got = same_weekday_values(values, origin_dow=2, origin=60, target_dow=2)
    assert list(got) == [60.0, 53.0, 46.0, 39.0]
    # target Thursday (dow 3): the latest Thursday at or before the origin is 6 days back
    got = same_weekday_values(values, origin_dow=2, origin=60, target_dow=3)
    assert list(got) == [54.0, 47.0, 40.0, 33.0]
    assert got.max() <= 60


def test_same_weekday_values_stop_at_the_start_of_the_series():
    assert list(same_weekday_values(np.arange(10.0), origin_dow=2, origin=9, target_dow=2)) == [9.0, 2.0]
    assert same_weekday_values(np.arange(3.0), origin_dow=2, origin=2, target_dow=1).size == 1


def test_no_training_target_comes_from_after_the_cutoff():
    series = {(1, 1): make_series(np.random.default_rng(3).poisson(5, 90).astype("float64"))}
    cutoff = pd.Timestamp("2026-08-03") + pd.Timedelta(days=59)

    samples = build_samples(truncate(series, cutoff), max_horizon=30)

    assert samples["target_date"].max() <= cutoff
    assert samples["origin_date"].max() < cutoff


def test_training_samples_do_not_change_when_the_future_changes():
    base = make_series(np.random.default_rng(4).poisson(5, 90).astype("float64"))
    changed = base.copy()
    changed.iloc[60:] = 12345.0
    cutoff = base.index[59]

    a = build_samples(truncate({(1, 1): base}, cutoff))
    b = build_samples(truncate({(1, 1): changed}, cutoff))

    pd.testing.assert_frame_equal(a, b)


def test_a_model_trained_up_to_a_cutoff_is_blind_to_later_data():
    rng = np.random.default_rng(5)
    base = {(k, 1): make_series(rng.poisson(3 + k, 100).astype("float64")) for k in range(1, 5)}
    changed = {k: v.copy() for k, v in base.items()}
    for v in changed.values():
        v.iloc[70:] = 500.0
    cutoff = pd.Timestamp("2026-08-03") + pd.Timedelta(days=69)

    history = base[(1, 1)][base[(1, 1)].index <= cutoff]
    a = GlobalDemandModel().fit(base, cutoff).predict(history, 14)
    b = GlobalDemandModel().fit(changed, cutoff).predict(history, 14)

    assert np.array_equal(a, b)


# ---- samples ----------------------------------------------------------------


def test_every_sample_has_all_features_and_a_matching_target():
    values = np.random.default_rng(6).poisson(4, 50).astype("float64")
    series = {(1, 2): make_series(values)}

    samples = build_samples(series, max_horizon=5)

    assert list(samples.columns[: len(FEATURE_NAMES)]) == FEATURE_NAMES
    assert not samples[FEATURE_NAMES].isna().any().any()
    # spot check: the target is exactly the value h days after the origin
    for _, row in samples.sample(10, random_state=0).iterrows():
        position = (row["target_date"] - series[(1, 2)].index[0]).days
        assert row["y"] == values[position]
        assert (row["target_date"] - row["origin_date"]).days == row["horizon"]
        assert (row["product_id"], row["warehouse_id"]) == (1, 2)


def test_short_series_produce_no_samples():
    assert build_samples({(1, 1): make_series(np.ones(MIN_HISTORY))}).empty


def test_the_target_calendar_flags_friday_and_saturday():
    series = make_series(np.ones(40))  # starts Monday 2026-08-03; day 39 is Thursday 2026-09-10
    frame = forecast_frame(series, horizon=7)

    weekday = dict(zip(frame["target_date"].dt.day_of_week, frame["target_is_weekend"]))
    assert weekday[4] == 1.0 and weekday[5] == 1.0  # Friday, Saturday
    assert all(weekday[d] == 0.0 for d in (0, 1, 2, 3, 6))
    assert list(frame["horizon"]) == [1, 2, 3, 4, 5, 6, 7]


def test_forecast_frame_needs_enough_history():
    with pytest.raises(ValueError, match="at least 28"):
        forecast_frame(make_series(np.ones(10)), horizon=3)


# ---- the model ---------------------------------------------------------------


def weekday_pattern_series(count, base, days=120, noise_seed=None):
    factor = np.array([1.0, 1.0, 1.0, 1.0, 0.4, 0.4, 1.0])  # Mon..Sun, Fri/Sat low
    dow = pd.date_range("2026-08-03", periods=days).day_of_week
    values = base * factor[dow]
    if noise_seed is not None:
        values = np.random.default_rng(noise_seed).poisson(values).astype("float64")

    return make_series(values)


def test_the_model_learns_the_weekday_pattern_that_a_flat_average_cannot():
    series = {(k, 1): weekday_pattern_series(k, base=5 + 3 * k) for k in range(1, 9)}
    cutoff = series[(1, 1)].index[-15]
    model = GlobalDemandModel().fit(series, cutoff)

    ml_errors, ma_errors = [], []
    for key, full in series.items():
        history = full[full.index <= cutoff]
        actual = full[full.index > cutoff].to_numpy()[:14]
        ml_errors.append(mae(actual, model.predict(history, 14)))
        ma_errors.append(mae(actual, moving_average_forecast(history.to_numpy(), 14, 14)))

    assert np.mean(ml_errors) < 0.5 * np.mean(ma_errors)


def test_predictions_are_non_negative_and_the_right_length():
    series = {(1, 1): weekday_pattern_series(1, base=0.3, noise_seed=1)}
    model = GlobalDemandModel().fit(series, series[(1, 1)].index[-1])

    forecast = model.predict(series[(1, 1)], 30)

    assert len(forecast) == 30
    assert (forecast >= 0).all()


def test_training_is_deterministic():
    series = {(k, 1): weekday_pattern_series(k, base=4 + k, noise_seed=k) for k in range(1, 6)}
    cutoff = series[(1, 1)].index[-1]

    a = GlobalDemandModel().fit(series, cutoff).predict(series[(1, 1)], 14)
    b = GlobalDemandModel().fit(series, cutoff).predict(series[(1, 1)], 14)

    assert np.array_equal(a, b)


def test_model_guards():
    model = GlobalDemandModel()
    history = make_series(np.ones(40))

    with pytest.raises(RuntimeError, match="not been trained"):
        model.predict(history, 3)

    assert model.can_forecast(history) is False
    model.fit({(1, 1): make_series(np.random.default_rng(0).poisson(4, 80).astype("float64"))}, "2026-10-20")
    assert model.can_forecast(history) is True
    assert model.can_forecast(make_series(np.ones(10))) is False

    with pytest.raises(ValueError, match="exceeds the trained maximum"):
        model.predict(history, 31)

    with pytest.raises(ValueError, match="Not enough history"):
        GlobalDemandModel().fit({(1, 1): make_series(np.ones(20))}, "2026-08-22")
