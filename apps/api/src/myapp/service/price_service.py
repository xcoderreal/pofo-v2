from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from myapp.domain.price import PriceBar, PriceSource, is_fetch_worth_attempting
from myapp.domain.repository import InstrumentRepository, PriceHistoryRepository


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
        # by "do we have it yet."
        if earliest_cached is not None and start < earliest_cached:
            new_bars = self.price_source.fetch_history(
                instrument.symbol, start, earliest_cached - timedelta(days=1)
            )
            if new_bars:
                self.price_history_repo.add_bars(instrument_id, new_bars)
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
                fetched_anything = True

        if fetched_anything:
            cached_bars = self.price_history_repo.get_bars(instrument_id)

        return sorted(
            (b for b in cached_bars if start <= b.date <= end), key=lambda b: b.date
        )
