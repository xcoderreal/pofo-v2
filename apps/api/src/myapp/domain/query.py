"""The generic time-series query interface's pure vocabulary
(docs/domain-model.md § Query interface): Metric/Mode/Granularity/GroupBy
as closed enums, the (metric, mode) validity table, the sparse result
shape, and period-boundary date bucketing.

No I/O here — the actual query (repo/PriceService lookups) lives in
service/query_service.py; this module is what makes the validity rules
and date math testable in isolation, with no fakes needed.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from enum import StrEnum


class Metric(StrEnum):
    EQUITY = "equity"
    SHARE_COUNT = "share_count"
    COST_BASIS = "cost_basis"
    CASH_BALANCE = "cash_balance"
    UNREALIZED_GAIN = "unrealized_gain"
    REALIZED_GAIN = "realized_gain"
    MARKET_PRICE = "market_price"


class Mode(StrEnum):
    POINT_IN_TIME = "point_in_time"
    CUMULATIVE = "cumulative"
    DELTA_PER_PERIOD = "delta_per_period"


class Granularity(StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class GroupBy(StrEnum):
    NONE = "none"
    INSTRUMENT = "instrument"
    ACCOUNT = "account"


class MetricKind(StrEnum):
    LEVEL = "level"
    FLOW = "flow"


_METRIC_KIND: dict[Metric, MetricKind] = {
    Metric.EQUITY: MetricKind.LEVEL,
    Metric.SHARE_COUNT: MetricKind.LEVEL,
    Metric.COST_BASIS: MetricKind.LEVEL,
    Metric.CASH_BALANCE: MetricKind.LEVEL,
    Metric.UNREALIZED_GAIN: MetricKind.LEVEL,
    Metric.MARKET_PRICE: MetricKind.LEVEL,
    Metric.REALIZED_GAIN: MetricKind.FLOW,
}

_VALID_MODES: dict[MetricKind, frozenset[Mode]] = {
    MetricKind.LEVEL: frozenset({Mode.POINT_IN_TIME}),
    MetricKind.FLOW: frozenset({Mode.CUMULATIVE, Mode.DELTA_PER_PERIOD}),
}


def metric_kind(metric: Metric) -> MetricKind:
    return _METRIC_KIND[metric]


def is_valid_metric_mode(metric: Metric, mode: Mode) -> bool:
    return mode in _VALID_MODES[_METRIC_KIND[metric]]


@dataclass
class TimeSeriesPoint:
    timestamp: date
    value: Decimal


@dataclass
class Series:
    group: str
    points: list[TimeSeriesPoint]


def period_boundaries(start: date, end: date, granularity: Granularity) -> list[date]:
    """Sampling dates within [start, end] at the given granularity — the
    end of each period, always including `end` itself (the final period
    may be partial). Empty if start is after end.

    Each boundary is computed from `start` plus N whole periods, never by
    chaining off the previous boundary — chaining a month-end start (e.g.
    Jan 31) would drift permanently downward (Jan 31 -> Feb 28 -> Mar 28
    -> Apr 28...) since each step's day-of-month feeds the next, instead
    of returning to the 31st whenever the target month has one."""
    if start > end:
        return []
    boundaries = []
    n = 0
    current = start
    while current < end:
        boundaries.append(current)
        n += 1
        current = _advance(start, granularity, n)
    boundaries.append(end)
    return boundaries


def _advance(start: date, granularity: Granularity, n: int) -> date:
    if granularity == Granularity.DAILY:
        return start + timedelta(days=n)
    if granularity == Granularity.WEEKLY:
        return start + timedelta(days=7 * n)
    if granularity == Granularity.MONTHLY:
        return _add_months(start, n)
    return _add_months(start, 12 * n)  # YEARLY


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)
