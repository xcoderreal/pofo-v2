from datetime import date

from myapp.domain.query import (
    Granularity,
    Metric,
    MetricKind,
    Mode,
    is_valid_metric_mode,
    metric_kind,
    period_boundaries,
)


class TestMetricModeValidity:
    """The full (Metric, Mode) validity table from docs/domain-model.md —
    every Level metric is point_in_time-only, the sole Flow metric
    (realized_gain) is cumulative/delta_per_period-only."""

    LEVEL_METRICS = [
        Metric.EQUITY,
        Metric.SHARE_COUNT,
        Metric.COST_BASIS,
        Metric.CASH_BALANCE,
        Metric.UNREALIZED_GAIN,
        Metric.MARKET_PRICE,
    ]

    def test_every_level_metric_is_point_in_time_only(self) -> None:
        for metric in self.LEVEL_METRICS:
            assert metric_kind(metric) == MetricKind.LEVEL
            assert is_valid_metric_mode(metric, Mode.POINT_IN_TIME) is True
            assert is_valid_metric_mode(metric, Mode.CUMULATIVE) is False
            assert is_valid_metric_mode(metric, Mode.DELTA_PER_PERIOD) is False

    def test_realized_gain_is_cumulative_or_delta_per_period_only(self) -> None:
        assert metric_kind(Metric.REALIZED_GAIN) == MetricKind.FLOW
        assert is_valid_metric_mode(Metric.REALIZED_GAIN, Mode.POINT_IN_TIME) is False
        assert is_valid_metric_mode(Metric.REALIZED_GAIN, Mode.CUMULATIVE) is True
        assert is_valid_metric_mode(Metric.REALIZED_GAIN, Mode.DELTA_PER_PERIOD) is True

    def test_every_metric_has_a_defined_kind(self) -> None:
        for metric in Metric:
            assert metric_kind(metric) in (MetricKind.LEVEL, MetricKind.FLOW)


class TestPeriodBoundaries:
    def test_daily_gives_one_boundary_per_day_inclusive(self) -> None:
        boundaries = period_boundaries(
            date(2026, 1, 1), date(2026, 1, 4), Granularity.DAILY
        )

        assert boundaries == [
            date(2026, 1, 1),
            date(2026, 1, 2),
            date(2026, 1, 3),
            date(2026, 1, 4),
        ]

    def test_weekly_steps_by_seven_days_and_always_includes_end(self) -> None:
        boundaries = period_boundaries(
            date(2026, 1, 1), date(2026, 1, 20), Granularity.WEEKLY
        )

        assert boundaries == [
            date(2026, 1, 1),
            date(2026, 1, 8),
            date(2026, 1, 15),
            date(2026, 1, 20),  # partial final period, still included
        ]

    def test_monthly_advances_by_calendar_month(self) -> None:
        boundaries = period_boundaries(
            date(2026, 1, 31), date(2026, 4, 30), Granularity.MONTHLY
        )

        assert boundaries == [
            date(2026, 1, 31),
            date(2026, 2, 28),  # clamped — Feb has no 31st
            date(2026, 3, 31),  # back to the 31st — not chained off Feb 28
            date(2026, 4, 30),  # partial final period, still included
        ]

    def test_monthly_does_not_drift_permanently_after_a_clamped_month(self) -> None:
        """The bug this guards against: computing each boundary by adding
        one month to the PREVIOUS boundary (rather than N months to the
        original start) would drift a month-end start permanently
        downward — Jan 31 -> Feb 28 -> Mar 28 -> Apr 28 -> ... — never
        returning to the 31st even in months that have one."""
        boundaries = period_boundaries(
            date(2026, 1, 31), date(2026, 7, 31), Granularity.MONTHLY
        )

        assert boundaries == [
            date(2026, 1, 31),
            date(2026, 2, 28),
            date(2026, 3, 31),
            date(2026, 4, 30),
            date(2026, 5, 31),
            date(2026, 6, 30),
            date(2026, 7, 31),
        ]

    def test_yearly_advances_by_twelve_months(self) -> None:
        boundaries = period_boundaries(
            date(2024, 1, 1), date(2026, 6, 1), Granularity.YEARLY
        )

        assert boundaries == [
            date(2024, 1, 1),
            date(2025, 1, 1),
            date(2026, 1, 1),
            date(2026, 6, 1),
        ]

    def test_single_day_range_gives_one_boundary(self) -> None:
        boundaries = period_boundaries(
            date(2026, 1, 1), date(2026, 1, 1), Granularity.MONTHLY
        )

        assert boundaries == [date(2026, 1, 1)]

    def test_start_after_end_gives_no_boundaries(self) -> None:
        boundaries = period_boundaries(
            date(2026, 1, 5), date(2026, 1, 1), Granularity.DAILY
        )

        assert boundaries == []
