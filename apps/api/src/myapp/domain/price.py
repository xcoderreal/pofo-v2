"""Price history: a PriceSource capability port, and the pure staleness
policy deciding when it's worth calling.

Lazy and incremental by design (docs/domain-model.md, docs/non-goals.md):
a fetch happens only when a request needs data not already stored, and
only for the missing gap — never on a schedule, never speculatively.
This module is what makes that "respectful of the upstream" property
provable in isolation, with no network involved.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from myapp.domain.model import AssetClass

_EASTERN = ZoneInfo("America/New_York")
_MARKET_OPEN = time(9, 30)
_MARKET_CLOSE = time(16, 0)

# How long a fetch attempt is considered fresh enough to skip a repeat
# call — for equities/ETFs, only while the market is open (see
# is_us_market_hours); for crypto, always eligible, but still throttled
# to this window since it trades continuously.
_TTL = timedelta(minutes=15)


@dataclass
class PriceBar:
    date: date
    close: Decimal


class PriceSource(ABC):
    @abstractmethod
    def fetch_history(self, symbol: str, start: date, end: date) -> list[PriceBar]: ...


def is_us_market_hours(now: datetime) -> bool:
    """A simple US/Eastern weekday 9:30-16:00 check — deliberately not a
    full trading-calendar dependency. False positives on holidays are
    acceptable (docs/domain-model.md): worst case is one harmless extra
    fetch attempt that returns unchanged data."""
    eastern_now = now.astimezone(_EASTERN)
    if eastern_now.weekday() >= 5:  # Saturday, Sunday
        return False
    return _MARKET_OPEN <= eastern_now.time() <= _MARKET_CLOSE


def is_fetch_worth_attempting(
    asset_class: AssetClass,
    last_fetched_at: datetime | None,
    now: datetime,
) -> bool:
    """Whether a price fetch attempt is worth making right now — the
    policy that keeps this app respectful of the upstream provider's
    rate limits without any explicit throttling logic. Never fetched
    before is always worth attempting; otherwise gated by asset class."""
    if last_fetched_at is None:
        return True
    if asset_class == AssetClass.CRYPTO:
        return now - last_fetched_at >= _TTL
    # Equity/ETF: outside market hours, nothing new could exist yet.
    if not is_us_market_hours(now):
        return False
    return now - last_fetched_at >= _TTL
