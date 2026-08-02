from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from myapp.domain.model import AssetClass
from myapp.domain.price import PriceBar, PriceSource, is_fetch_worth_attempting
from myapp.domain.repository import InstrumentRepository, PriceHistoryRepository

# Window used by get_latest_price to find the most recent bar — wide enough
# to cross a weekend or a short holiday gap.
_LATEST_PRICE_LOOKBACK = timedelta(days=7)


class InstrumentNotFoundError(Exception):
    """No instrument with this id exists."""


@dataclass
class PriceService:
    price_source: PriceSource
    price_history_repo: PriceHistoryRepository
    instrument_repo: InstrumentRepository
    clock: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))

    def get_price_history(
        self, instrument_id: str, start: date, end: date
    ) -> list[PriceBar]:
        instrument = self.instrument_repo.get(instrument_id)
        if instrument is None:
            raise InstrumentNotFoundError(f"Instrument {instrument_id!r} not found")

        cached_bars = self.price_history_repo.get_bars(instrument_id)
        cached_dates = [b.date for b in cached_bars]
        earliest_cached = min(cached_dates) if cached_dates else None
        latest_cached = max(cached_dates) if cached_dates else None

        fetched_anything = False

        # Backward gap: older data never fetched (e.g. a chart widening its
        # requested range to further in the past). Historical bars are
        # immutable once past — this isn't a freshness question, so it's
        # not gated by is_fetch_worth_attempting's staleness policy, only
        # by "have we asked for it yet."
        #
        # "Asked", not "have it": a window with no bars in it — a weekend,
        # a holiday, the seven days query_service reaches back to resolve a
        # non-trading range boundary — leaves `start < earliest_cached`
        # permanently true, so keying the branch on cached data alone made
        # every repeat of the same request issue another upstream fetch.
        # The floor is the earliest date the source has already been asked
        # about, which is the fact that actually settles the question.
        backfill_floor = self.price_history_repo.get_backfill_floor(instrument_id)
        if (
            earliest_cached is not None
            and start < earliest_cached
            and (backfill_floor is None or start < backfill_floor)
        ):
            new_bars = self.price_source.fetch_history(
                instrument.symbol, start, earliest_cached - timedelta(days=1)
            )
            if new_bars:
                self.price_history_repo.add_bars(instrument_id, new_bars)
            self._lower_backfill_floor(instrument_id, start)
            fetched_anything = True

        # Forward gap: possibly-new data since the last check. This IS a
        # freshness question, so it's gated by the staleness policy —
        # the thing that keeps this respectful of the upstream provider.
        forward_gap_start = (
            latest_cached + timedelta(days=1) if latest_cached else start
        )
        if forward_gap_start <= end:
            now = self.clock()
            last_fetched_at = self.price_history_repo.get_last_fetched_at(instrument_id)
            if is_fetch_worth_attempting(instrument.asset_class, last_fetched_at, now):
                new_bars = self.price_source.fetch_history(
                    instrument.symbol, forward_gap_start, end
                )
                if new_bars:
                    self.price_history_repo.add_bars(instrument_id, new_bars)
                self.price_history_repo.set_last_fetched_at(instrument_id, now)
                # The very first fetch for an instrument comes through here
                # with nothing cached, so it starts at `start` and is what
                # establishes the floor — otherwise the next identical call
                # would re-ask the backward branch for a window this one
                # already covered.
                self._lower_backfill_floor(instrument_id, forward_gap_start)
                fetched_anything = True

        if fetched_anything:
            cached_bars = self.price_history_repo.get_bars(instrument_id)

        return sorted(
            (b for b in cached_bars if start <= b.date <= end), key=lambda b: b.date
        )

    def _lower_backfill_floor(self, instrument_id: str, start: date) -> None:
        """Move the "already asked this far back" mark earlier, never
        later — a fetch that began at a *later* date says nothing new
        about the window below the existing floor."""
        current = self.price_history_repo.get_backfill_floor(instrument_id)
        if current is None or start < current:
            self.price_history_repo.set_backfill_floor(instrument_id, start)

    def get_latest_price(self, instrument_id: str) -> PriceBar | None:
        """The most recent known price for an instrument. CASH is priced
        at a hardcoded 1 — its price is definitional, not a market fact,
        and there's no real ticker for it to fetch (see cash_service.py's
        module docstring).

        Triggers get_price_history over a recent window purely to let its
        lazy-fetch logic pull in anything new — but the result is read
        back from ALL cached bars, not filtered to that window. A real
        cached price older than the window (a rarely-traded instrument, or
        a forward-gap fetch declined by the staleness policy) is still the
        latest known price and must not be treated as "no data" just
        because it falls outside an arbitrary lookback range.
        """
        instrument = self.instrument_repo.get(instrument_id)
        if instrument is None:
            raise InstrumentNotFoundError(f"Instrument {instrument_id!r} not found")

        if instrument.asset_class == AssetClass.CASH:
            return PriceBar(date=self.clock().date(), close=Decimal(1))

        end = self.clock().date()
        start = end - _LATEST_PRICE_LOOKBACK
        self.get_price_history(instrument_id, start, end)

        cached_bars = self.price_history_repo.get_bars(instrument_id)
        return max(cached_bars, key=lambda b: b.date) if cached_bars else None
