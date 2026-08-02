"""The generic time-series query — one query answering arbitrary
metric x instrument-scope x account-scope x granularity x mode
breakdowns (docs/domain-model.md § Query interface), replacing what
would otherwise be a page/endpoint per breakdown combination.

Composes AccountRepository/InstrumentRepository/TransactionRepository
directly rather than TransactionService/GainsService, because those
compute a Position as of *now* — this needs a Position as of every
sampled boundary date in the requested range, via compute_position's
`as_of` parameter.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from myapp.domain.model import AssetClass
from myapp.domain.position import compute_lots, compute_position, realized_gain_events
from myapp.domain.query import (
    Granularity,
    GroupBy,
    Metric,
    MetricKind,
    Mode,
    Scope,
    Series,
    TimeSeriesPoint,
    is_unconstrained,
    is_valid_metric_mode,
    metric_kind,
    period_boundaries,
)
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    TransactionRepository,
)
from myapp.service.cash_service import CASH_INSTRUMENT_ID
from myapp.service.price_service import PriceService

# How far before the requested start to look for a price bar. A range's
# own start date very often has no bar of its own — it's a weekend or a
# holiday — and a holding's value on a Saturday is Friday's close, not
# "unknown". Without this the first boundary is silently dropped and every
# range-scoped comparison quietly measures from the first trading day
# instead of from the range start.
#
# Only the FIRST boundary can ever see these earlier bars: every interior
# boundary's candidate window is bounded below by the previous boundary
# (see _resample_price), so this cannot carry a price forward across an
# interior gap. Seven days is the same "cross a weekend or a short
# holiday" window PriceService uses for its latest-price lookback.
_PRICE_START_LOOKBACK = timedelta(days=7)


class InvalidMetricModeError(Exception):
    """This (metric, mode) pair isn't valid — see docs/domain-model.md's
    Level/Flow validity table."""


class AccountsNotApplicableError(Exception):
    """`accounts` (or `group_by=account`) was given but this metric has
    no account dimension."""


class InstrumentsNotApplicableError(Exception):
    """`instruments` was given but this metric always targets a single,
    fixed instrument (cash_balance -> CASH) — there's no instrument
    dimension for it to filter."""


# equity/cost_basis/unrealized_gain summed across "all" instruments would
# double-count: a dollar spent buying an instrument has already left the
# CASH position (CashService.log_trade's paired leg), so adding CASH's
# dollar balance back into a portfolio-wide total counts it twice. Only
# narrows what "all" expands to — an explicit instruments=["cash"] request
# for one of these metrics is still honored (docs/domain-model.md).
_EXCLUDES_CASH_FROM_ALL = frozenset(
    {Metric.EQUITY, Metric.COST_BASIS, Metric.UNREALIZED_GAIN}
)


@dataclass
class QueryService:
    account_repo: AccountRepository
    instrument_repo: InstrumentRepository
    transaction_repo: TransactionRepository
    price_service: PriceService

    def query_timeseries(
        self,
        *,
        user_id: str,
        metric: Metric,
        instruments: Scope,
        accounts: Scope,
        group_by: GroupBy,
        start: date,
        end: date,
        granularity: Granularity,
        mode: Mode,
    ) -> list[Series]:
        if not is_valid_metric_mode(metric, mode):
            raise InvalidMetricModeError(
                f"mode {mode!r} is not valid for metric {metric!r}"
            )
        if metric == Metric.MARKET_PRICE and (
            not is_unconstrained(accounts) or group_by == GroupBy.ACCOUNT
        ):
            raise AccountsNotApplicableError(
                "accounts has no meaning for market_price — it has no account dimension"
            )
        if metric == Metric.CASH_BALANCE and not is_unconstrained(instruments):
            raise InstrumentsNotApplicableError(
                "instruments has no meaning for cash_balance — "
                "it always targets the CASH instrument"
            )

        instrument_ids = self._resolve_instruments(instruments, metric)
        pairs = self._resolve_pairs(metric, user_id, accounts, instrument_ids)

        raw: dict[tuple[str | None, str], Series] = {}
        for account_id, instrument_id in pairs:
            points = self._points(
                metric, mode, account_id, instrument_id, start, end, granularity
            )
            if points:
                raw[(account_id, instrument_id)] = Series(
                    group=instrument_id, points=points
                )

        return self._group(raw, group_by, carry_forward=_carries_forward(metric, mode))

    # ─── Scope resolution ────────────────────────────────────────

    def _resolve_instruments(self, instruments: Scope, metric: Metric) -> list[str]:
        catalog = self.instrument_repo.list_all()
        if is_unconstrained(instruments):
            if metric in _EXCLUDES_CASH_FROM_ALL:
                return sorted(i.id for i in catalog if i.asset_class != AssetClass.CASH)
            return sorted(i.id for i in catalog)
        catalog_ids = {i.id for i in catalog}
        return sorted(catalog_ids & set(instruments))

    def _resolve_accounts(self, user_id: str, accounts: Scope) -> list[str]:
        owned_ids = {a.id for a in self.account_repo.list_by_user(user_id)}
        if is_unconstrained(accounts):
            return sorted(owned_ids)
        return sorted(owned_ids & set(accounts))

    def _resolve_pairs(
        self,
        metric: Metric,
        user_id: str,
        accounts: Scope,
        instrument_ids: list[str],
    ) -> list[tuple[str | None, str]]:
        if metric == Metric.MARKET_PRICE:
            return [(None, instrument_id) for instrument_id in instrument_ids]
        account_ids = self._resolve_accounts(user_id, accounts)
        if metric == Metric.CASH_BALANCE:
            return [(account_id, CASH_INSTRUMENT_ID) for account_id in account_ids]
        return [
            (account_id, instrument_id)
            for account_id in account_ids
            for instrument_id in instrument_ids
        ]

    # ─── Per-pair computation ───────────────────────────────────

    def _points(
        self,
        metric: Metric,
        mode: Mode,
        account_id: str | None,
        instrument_id: str,
        start: date,
        end: date,
        granularity: Granularity,
    ) -> list[TimeSeriesPoint]:
        if metric_kind(metric) == MetricKind.FLOW:
            return self._realized_gain_points(
                account_id, instrument_id, start, end, granularity, mode
            )
        return self._level_points(
            metric, account_id, instrument_id, start, end, granularity
        )

    def _level_points(
        self,
        metric: Metric,
        account_id: str | None,
        instrument_id: str,
        start: date,
        end: date,
        granularity: Granularity,
    ) -> list[TimeSeriesPoint]:
        boundaries = period_boundaries(start, end, granularity)

        if metric == Metric.MARKET_PRICE:
            resampled = self._resampled_prices(instrument_id, start, end, boundaries)
            return [
                TimeSeriesPoint(timestamp=b, value=v)
                for b, v in sorted(resampled.items())
            ]

        transactions = self.transaction_repo.list_by_account_instrument(
            account_id, instrument_id
        )
        if not transactions:
            return []
        first_activity = min(t.timestamp.date() for t in transactions)

        needs_price = metric in (Metric.EQUITY, Metric.UNREALIZED_GAIN)
        price_by_boundary = (
            self._resampled_prices(instrument_id, start, end, boundaries)
            if needs_price
            else {}
        )

        points = []
        for boundary in boundaries:
            if boundary < first_activity:
                continue
            position = compute_position(
                account_id, instrument_id, transactions, as_of=boundary
            )
            if metric in (Metric.SHARE_COUNT, Metric.CASH_BALANCE):
                points.append(
                    TimeSeriesPoint(timestamp=boundary, value=position.share_count)
                )
            elif metric == Metric.COST_BASIS:
                points.append(
                    TimeSeriesPoint(timestamp=boundary, value=position.cost_basis)
                )
            else:
                price = price_by_boundary.get(boundary)
                if price is None:
                    continue
                equity = position.share_count * price
                value = (
                    equity if metric == Metric.EQUITY else equity - position.cost_basis
                )
                points.append(TimeSeriesPoint(timestamp=boundary, value=value))
        return points

    def _resampled_prices(
        self, instrument_id: str, start: date, end: date, boundaries: list[date]
    ) -> dict[date, Decimal]:
        return _resample_price(
            self._price_lookup(instrument_id, start, end), boundaries
        )

    def _price_lookup(
        self, instrument_id: str, start: date, end: date
    ) -> dict[date, Decimal]:
        """CASH is priced at a hardcoded 1 for every day in range — its
        price is definitional, not a market fact (see
        price_service.py's get_latest_price docstring); there's no real
        ticker for it to fetch, and it needs no lookback since every day
        already has a price.

        Everything else reads from `start - _PRICE_START_LOOKBACK` so the
        first boundary can resolve to the last close at or before it."""
        instrument = self.instrument_repo.get(instrument_id)
        if instrument is not None and instrument.asset_class == AssetClass.CASH:
            if start > end:
                return {}
            days = (end - start).days
            return {start + timedelta(days=i): Decimal(1) for i in range(days + 1)}
        bars = self.price_service.get_price_history(
            instrument_id, start - _PRICE_START_LOOKBACK, end
        )
        return {bar.date: bar.close for bar in bars}

    def _realized_gain_points(
        self,
        account_id: str | None,
        instrument_id: str,
        start: date,
        end: date,
        granularity: Granularity,
        mode: Mode,
    ) -> list[TimeSeriesPoint]:
        transactions = self.transaction_repo.list_by_account_instrument(
            account_id, instrument_id
        )
        if not transactions:
            return []
        lots = compute_lots(transactions)
        events = [
            (transaction.timestamp.date(), gain)
            for transaction, gain in realized_gain_events(lots)
            if start <= transaction.timestamp.date() <= end
        ]
        if not events:
            return []

        boundaries = period_boundaries(start, end, granularity)
        by_period = dict.fromkeys(boundaries, Decimal(0))
        for event_date, gain in events:
            boundary = next(b for b in boundaries if b >= event_date)
            by_period[boundary] += gain

        if mode == Mode.DELTA_PER_PERIOD:
            return [
                TimeSeriesPoint(timestamp=b, value=v)
                for b, v in sorted(by_period.items())
                if v != 0
            ]

        # cumulative — a running total, real (not padding) from the first
        # period with any gain onward, since the running total itself is
        # a meaningful fact at every subsequent boundary.
        points = []
        running = Decimal(0)
        started = False
        for boundary in sorted(by_period):
            if by_period[boundary] != 0:
                started = True
            if started:
                running += by_period[boundary]
                points.append(TimeSeriesPoint(timestamp=boundary, value=running))
        return points

    # ─── Grouping ────────────────────────────────────────────────

    def _group(
        self,
        raw: dict[tuple[str | None, str], Series],
        group_by: GroupBy,
        *,
        carry_forward: bool,
    ) -> list[Series]:
        buckets: dict[str, list[Series]] = {}
        for (account_id, instrument_id), series in raw.items():
            if group_by == GroupBy.NONE:
                key = "total"
            elif group_by == GroupBy.INSTRUMENT:
                key = instrument_id
            else:  # ACCOUNT
                key = account_id or "unknown"
            buckets.setdefault(key, []).append(series)

        result = []
        for group_name, series_list in buckets.items():
            combined = _combine(series_list, group_name, carry_forward=carry_forward)
            if combined is not None:
                result.append(combined)
        return result


def _resample_price(
    price_by_date: dict[date, Decimal], boundaries: list[date]
) -> dict[date, Decimal]:
    """Last known price at-or-before each boundary, but not before the
    previous boundary — real data only, downsampled to the requested
    granularity, never carried forward across an empty period."""
    result = {}
    sorted_dates = sorted(price_by_date)
    period_start: date | None = None
    for boundary in boundaries:
        candidates = [
            d
            for d in sorted_dates
            if (period_start is None or d > period_start) and d <= boundary
        ]
        if candidates:
            result[boundary] = price_by_date[max(candidates)]
        period_start = boundary
    return result


def _carries_forward(metric: Metric, mode: Mode) -> bool:
    """Whether a contributing series with no sample at a combined
    boundary contributes its **last known value** or **zero**.

    A Level is a stock: a holding you still own is still worth its last
    close, so an absent sample means "unchanged", not "gone". A Flow in
    `delta_per_period` is the amount booked *inside* that bucket — a
    bucket with no sale earned nothing, and carrying the previous
    bucket's figure forward would book the same gain again in every
    later bucket. `cumulative` is a running total, which is a stock
    again and behaves like a Level.
    """
    if metric_kind(metric) == MetricKind.LEVEL:
        return True
    return mode == Mode.CUMULATIVE


def _combine(
    series_list: list[Series], group_name: str, *, carry_forward: bool
) -> Series | None:
    """Sum a group's contributing series over the **union** of their
    timestamps.

    The series are sparse *independently*: a price metric is only sampled
    at boundaries where that instrument has a bar, and every (account,
    instrument) pair starts at its own first transaction. So a timestamp
    present in some series and absent from others is the normal case —
    the last boundary of a range ending on a Sunday is carried by a
    crypto holding and not by an equity one — and reading that absence as
    zero makes the group total a **partial sum over whichever series
    happened to have a bar there**, presented as a whole-portfolio
    figure.

    Two rules, both following from Level-vs-Flow (`_carries_forward`):

    - **Before** a series' first sample it contributes zero. A position
      that did not exist yet genuinely contributed nothing, and carrying
      a value backwards would fabricate history — including the
      range-start sample every range-scoped percentage is defined
      against (behaviour.md § Percentages).
    - **After** it, a Level contributes its last known value.

    This is *not* the gap-padding that behaviour.md § Chart forbids, and
    the distinction is the whole point: the result's timestamps are still
    exactly the union of what the contributing series really sampled —
    nothing is invented, and a boundary no series sampled stays absent.
    Carry-forward only fills a *value* at a boundary the group already
    emits. Do not "simplify" this back into a plain sum; that is the bug
    this replaced. The mirror rule on the client is `addSeries` in
    `apps/mobile/lib/positions.ts`.
    """
    timestamps = sorted({point.timestamp for s in series_list for point in s.points})
    if not timestamps:
        return None

    totals = dict.fromkeys(timestamps, Decimal(0))
    for series in series_list:
        by_date = {point.timestamp: point.value for point in series.points}
        carried: Decimal | None = None
        for timestamp in timestamps:
            value = by_date.get(timestamp)
            if value is None:
                # None => before this series' first sample; carried
                # otherwise (and still zero for a per-period flow).
                value = carried if carry_forward and carried is not None else Decimal(0)
            else:
                carried = value
            totals[timestamp] += value

    return Series(
        group=group_name,
        points=[TimeSeriesPoint(timestamp=t, value=totals[t]) for t in timestamps],
    )
