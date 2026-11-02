import pandas as pd
import pytest

from app.data.series import daily_demand, last_local_day, series_map, to_local_day


def ledger(rows):
    frame = pd.DataFrame(
        rows, columns=["id", "product_id", "warehouse_id", "type", "quantity", "created_at"]
    )
    frame["created_at"] = pd.to_datetime(frame["created_at"])

    return frame


def series_of(frame, key=(1, 1), **kwargs):
    return series_map(daily_demand(frame, **kwargs))[key]


def test_issue_quantities_become_positive_demand_summed_per_local_day():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 100, "2026-10-01 03:00"),
            (2, 1, 1, "ISSUE", -3, "2026-10-01 04:00"),
            (3, 1, 1, "ISSUE", -2, "2026-10-01 05:30"),
            (4, 1, 1, "ISSUE", -4, "2026-10-02 04:00"),
        ]
    )

    series = series_of(frame)

    assert series.to_dict() == {pd.Timestamp("2026-10-01"): 5.0, pd.Timestamp("2026-10-02"): 4.0}


def test_days_without_issues_are_filled_with_zero_up_to_the_last_day():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 50, "2026-10-01 03:00"),
            (2, 1, 1, "ISSUE", -3, "2026-10-01 04:00"),
            (3, 1, 1, "ISSUE", -1, "2026-10-05 04:00"),
        ]
    )

    series = series_of(frame)

    assert list(series.index) == list(pd.date_range("2026-10-01", "2026-10-05"))
    assert list(series.values) == [3.0, 0.0, 0.0, 0.0, 1.0]


def test_a_series_starts_at_its_first_movement_of_any_type():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 50, "2026-10-01 03:00"),
            (2, 2, 1, "RECEIPT", 50, "2026-10-04 03:00"),
            (3, 2, 1, "ISSUE", -2, "2026-10-06 03:00"),
            (4, 1, 1, "ISSUE", -1, "2026-10-06 03:00"),
        ]
    )

    demand = series_map(daily_demand(frame))

    assert demand[(1, 1)].index.min() == pd.Timestamp("2026-10-01")
    assert demand[(2, 1)].index.min() == pd.Timestamp("2026-10-04")
    assert demand[(2, 1)].index.max() == demand[(1, 1)].index.max() == pd.Timestamp("2026-10-06")
    assert list(demand[(2, 1)].values) == [0.0, 0.0, 2.0]


def test_a_series_without_any_issue_is_all_zero_not_missing():
    frame = ledger([(1, 1, 1, "RECEIPT", 50, "2026-10-01 03:00"), (2, 2, 1, "ISSUE", -1, "2026-10-03 03:00")])

    series = series_of(frame, key=(1, 1))

    assert list(series.values) == [0.0, 0.0, 0.0]


def test_series_are_kept_apart_by_product_and_warehouse():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 9, "2026-10-01 03:00"),
            (2, 1, 2, "RECEIPT", 9, "2026-10-01 03:00"),
            (3, 1, 1, "ISSUE", -1, "2026-10-01 04:00"),
            (4, 1, 2, "ISSUE", -5, "2026-10-01 04:00"),
        ]
    )

    demand = series_map(daily_demand(frame))

    assert set(demand) == {(1, 1), (1, 2)}
    assert demand[(1, 1)].iloc[0] == 1.0
    assert demand[(1, 2)].iloc[0] == 5.0


@pytest.mark.parametrize(
    "utc_time, local_date",
    [
        ("2026-10-01 17:59", "2026-10-01"),  # 23:59 local
        ("2026-10-01 18:00", "2026-10-02"),  # 00:00 local
        ("2026-10-01 18:00:01", "2026-10-02"),
        ("2026-10-01 19:03", "2026-10-02"),  # an off-hours movement lands on the next local day
        ("2026-10-01 00:00", "2026-10-01"),
    ],
)
def test_local_days_use_the_utc_plus_six_convention(utc_time, local_date):
    stamps = pd.Series(pd.to_datetime([utc_time]))

    assert to_local_day(stamps, 6).iloc[0] == pd.Timestamp(local_date)


def test_the_offset_is_configurable():
    stamps = pd.Series(pd.to_datetime(["2026-10-01 18:00"]))

    assert to_local_day(stamps, 0).iloc[0] == pd.Timestamp("2026-10-01")
    assert to_local_day(stamps, 7).iloc[0] == pd.Timestamp("2026-10-02")


def test_an_issue_at_the_day_boundary_is_bucketed_by_local_day():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 50, "2026-10-01 03:00"),
            (2, 1, 1, "ISSUE", -2, "2026-10-01 17:59"),
            (3, 1, 1, "ISSUE", -3, "2026-10-01 18:00"),
        ]
    )

    series = series_of(frame)

    assert series[pd.Timestamp("2026-10-01")] == 2.0
    assert series[pd.Timestamp("2026-10-02")] == 3.0


def test_nothing_after_the_as_of_day_is_used():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 50, "2026-10-01 03:00"),
            (2, 1, 1, "ISSUE", -2, "2026-10-02 04:00"),
            (3, 1, 1, "ISSUE", -9, "2026-10-04 04:00"),
        ]
    )

    series = series_of(frame, as_of="2026-10-03")

    assert series.index.max() == pd.Timestamp("2026-10-03")
    assert list(series.values) == [0.0, 2.0, 0.0]
    assert 9.0 not in series.values


def test_a_series_that_starts_after_as_of_does_not_appear():
    frame = ledger([(1, 1, 1, "RECEIPT", 5, "2026-10-01 03:00"), (2, 2, 1, "RECEIPT", 5, "2026-10-10 03:00")])

    assert set(series_map(daily_demand(frame, as_of="2026-10-05"))) == {(1, 1)}


def test_an_empty_ledger_gives_an_empty_frame_and_no_last_day():
    empty = ledger([])

    assert daily_demand(empty).empty
    with pytest.raises(ValueError):
        last_local_day(empty)


def test_last_local_day_follows_the_offset():
    frame = ledger([(1, 1, 1, "RECEIPT", 5, "2026-10-01 19:00")])

    assert last_local_day(frame, 6) == pd.Timestamp("2026-10-02")
    assert last_local_day(frame, 0) == pd.Timestamp("2026-10-01")


def test_reserved_and_other_movements_do_not_count_as_demand():
    frame = ledger(
        [
            (1, 1, 1, "RECEIPT", 50, "2026-10-01 03:00"),
            (2, 1, 1, "RESERVATION", 0, "2026-10-01 04:00"),
            (3, 1, 1, "ADJUSTMENT", -5, "2026-10-01 05:00"),
            (4, 1, 1, "TRANSFER_OUT", -7, "2026-10-01 06:00"),
        ]
    )

    assert series_of(frame).sum() == 0.0
