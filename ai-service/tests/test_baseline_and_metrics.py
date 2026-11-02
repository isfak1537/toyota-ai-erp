import math

import numpy as np
import pytest

from app.forecasting.baseline import backtest_mae, moving_average_forecast, select_window
from app.forecasting.metrics import bias, mae, rmse, summarise, wape


# ---- metrics: hand-computed ------------------------------------------------


def test_mae_rmse_bias_wape_on_a_known_vector():
    y = [1, 2, 3]
    yhat = [2, 2, 5]  # errors: +1, 0, +2

    assert mae(y, yhat) == pytest.approx(1.0)
    assert bias(y, yhat) == pytest.approx(1.0)
    assert wape(y, yhat) == pytest.approx(3 / 6)
    assert rmse(y, yhat) == pytest.approx(math.sqrt(5 / 3))


def test_bias_is_signed_and_mae_is_not():
    y = [4, 4]
    assert bias(y, [2, 6]) == pytest.approx(0.0)
    assert mae(y, [2, 6]) == pytest.approx(2.0)
    assert bias(y, [1, 1]) == pytest.approx(-3.0)


def test_a_perfect_forecast_scores_zero():
    assert mae([3, 0, 5], [3, 0, 5]) == 0.0
    assert wape([3, 0, 5], [3, 0, 5]) == 0.0


def test_wape_is_nan_without_any_demand():
    assert math.isnan(wape([0, 0, 0], [1, 1, 1]))


@pytest.mark.parametrize("fn", [mae, rmse, bias, wape])
def test_metrics_reject_mismatched_or_empty_input(fn):
    with pytest.raises(ValueError):
        fn([1, 2], [1])
    with pytest.raises(ValueError):
        fn([], [])


def test_macro_and_micro_averages_differ_when_series_differ_in_size():
    pairs = {
        "short": ([0.0, 0.0], [1.0, 1.0]),  # MAE 1
        "long": ([0.0, 0.0, 0.0, 0.0], [3.0, 3.0, 3.0, 3.0]),  # MAE 3
    }

    summary = summarise(pairs)

    assert summary.series == 2
    assert summary.macro_mae == pytest.approx(2.0)  # (1 + 3) / 2
    assert summary.micro_mae == pytest.approx((2 * 1 + 4 * 3) / 6)  # pooled days
    assert summary.bias == pytest.approx((2 * 1 + 4 * 3) / 6)
    assert set(summary.as_dict()) == {"series", "macro_mae", "micro_mae", "wape", "bias"}


def test_summarise_needs_at_least_one_series():
    with pytest.raises(ValueError):
        summarise({})


# ---- baseline: hand-computed ------------------------------------------------


def test_moving_average_is_the_mean_of_the_last_window_repeated():
    history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    assert list(moving_average_forecast(history, window=3, horizon=4)) == [9.0, 9.0, 9.0, 9.0]  # (8+9+10)/3
    assert list(moving_average_forecast(history, window=10, horizon=2)) == [5.5, 5.5]


def test_a_short_history_uses_what_exists():
    assert list(moving_average_forecast([2, 4], window=7, horizon=3)) == [3.0, 3.0, 3.0]
    assert list(moving_average_forecast([5], window=14, horizon=1)) == [5.0]


def test_the_baseline_only_looks_at_the_most_recent_days():
    old_then_quiet = [100] * 30 + [0] * 7

    assert moving_average_forecast(old_then_quiet, window=7, horizon=1)[0] == 0.0
    assert moving_average_forecast(old_then_quiet, window=14, horizon=1)[0] == pytest.approx(50.0)  # 7 zeros and 7 hundreds


@pytest.mark.parametrize("history, window, horizon", [([], 7, 3), ([1, 2], 0, 3), ([1, 2], 7, 0)])
def test_the_baseline_rejects_impossible_requests(history, window, horizon):
    with pytest.raises(ValueError):
        moving_average_forecast(history, window, horizon)


def test_the_forecast_is_never_negative():
    assert moving_average_forecast([0, 0, 0], window=3, horizon=2).min() >= 0.0
    # bad input (a negative "demand") must not produce a negative forecast either
    assert list(moving_average_forecast([-5.0, -3.0], window=2, horizon=2)) == [0.0, 0.0]


# ---- window selection (rolling origin, training history only) ---------------


def test_backtest_mae_matches_a_hand_computed_origin():
    # 28 days: 14 days of 2s then 14 days of 6s; one origin at day 14, horizon 14
    history = [2.0] * 14 + [6.0] * 14

    # window 7 at origin 14 -> forecast 2 for days 14..27 whose actual is 6 -> MAE 4
    assert backtest_mae(history, window=7, horizon=14, n_origins=1) == pytest.approx(4.0)


def test_each_origin_only_sees_days_before_its_targets():
    history = [1.0] * 20 + [1000.0] * 14  # a spike in the last 14 days

    # origin = 34 - 14 = 20: the forecast is built from the 1s only, the target is the spike
    assert backtest_mae(history, window=7, horizon=14, n_origins=1) == pytest.approx(999.0)


def test_too_short_a_history_cannot_be_backtested():
    assert backtest_mae([1.0] * 20, window=7, horizon=14) is None


def test_select_window_prefers_the_short_window_after_a_level_shift():
    history = [2.0] * 40 + [10.0] * 14

    window, scores = select_window(history, horizon=7, n_origins=1)

    assert window == 7
    assert scores[7] < scores[14]


def test_select_window_prefers_the_long_window_for_noisy_but_flat_demand():
    rng = np.random.default_rng(3)
    history = rng.poisson(5, size=120).astype(float)

    window, scores = select_window(history, horizon=7, n_origins=6, step=7)

    assert window == 14
    assert scores[14] <= scores[7]


def test_ties_and_unusable_histories_go_to_the_longest_window():
    assert select_window([3.0] * 60, horizon=7)[0] == 14
    assert select_window([3.0] * 5, horizon=14)[0] == 14
