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
from typing import Literal

from myapp.domain.model import AssetClass
from myapp.domain.position import compute_lots, compute_position, realized_gain_events
from myapp.domain.query import (
    Granularity,
    GroupBy,
    Metric,
    MetricKind,
    Mode,
    Series,
    TimeSeriesPoint,
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

# A resolved scope: an explicit id list, the literal "all", or (accounts
# only) None meaning "not provided at all" — the signal the market_price
# validation needs, since "all" and "omitted" mean different things there.
Scope = list[str] | Literal["all"] | None


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


def _is_unconstrained(scope: Scope) -> bool:
    """Omitted, or an explicit-but-non-narrowing "all" — the only values
    that don't request a real filter along this dimension."""
    return scope is None or scope == "all" or scope == ["all"]


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
            not _is_unconstrained(accounts) or group_by == GroupBy.ACCOUNT
        ):
            raise AccountsNotApplicableError(
                "accounts has no meaning for market_price — it has no account dimension"
            )
        if metric == Metric.CASH_BALANCE and not _is_unconstrained(instruments):
            raise InstrumentsNotApplicableError(
                "instruments has no meaning for cash_balance — "
                "it always targets the CASH instrument"
            )

        instrument_ids = self._resolve_instruments(instruments)
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

        return self._group(raw, group_by)

    # ─── Scope resolution ────────────────────────────────────────

    def _resolve_instruments(self, instruments: Scope) -> list[str]:
        catalog_ids = {i.id for i in self.instrument_repo.list_all()}
        if _is_unconstrained(instruments):
            return sorted(catalog_ids)
        return sorted(catalog_ids & set(instruments))

    def _resolve_accounts(self, user_id: str, accounts: Scope) -> list[str]:
        owned_ids = {a.id for a in self.account_repo.list_by_user(user_id)}
        if _is_unconstrained(accounts):
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
        ticker for it to fetch."""
        instrument = self.instrument_repo.get(instrument_id)
        if instrument is not None and instrument.asset_class == AssetClass.CASH:
            if start > end:
                return {}
            days = (end - start).days
            return {start + timedelta(days=i): Decimal(1) for i in range(days + 1)}
        bars = self.price_service.get_price_history(instrument_id, start, end)
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
        self, raw: dict[tuple[str | None, str], Series], group_by: GroupBy
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
            combined = _combine(series_list, group_name)
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


def _combine(series_list: list[Series], group_name: str) -> Series | None:
    by_date: dict[date, Decimal] = {}
    for series in series_list:
        for point in series.points:
            by_date[point.timestamp] = (
                by_date.get(point.timestamp, Decimal(0)) + point.value
            )
    if not by_date:
        return None
    points = [TimeSeriesPoint(timestamp=d, value=v) for d, v in sorted(by_date.items())]
    return Series(group=group_name, points=points)
