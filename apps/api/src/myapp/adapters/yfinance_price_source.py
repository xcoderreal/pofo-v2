"""yfinance-backed PriceSource.

The `ticker_factory` is injectable specifically so the row-to-PriceBar
mapping logic (column names, date handling, Decimal conversion) can be
unit tested against a real, small pandas DataFrame without ever touching
the network — see tests/unit/adapters/test_yfinance_price_source.py.
"""

from collections.abc import Callable
from datetime import date, timedelta
from decimal import Decimal
from typing import Protocol

import yfinance as yf

from myapp.domain.price import PriceBar, PriceSource


class _HistoryFrame(Protocol):
    def iterrows(self): ...


class _TickerLike(Protocol):
    def history(self, start: str, end: str) -> _HistoryFrame: ...


class YFinancePriceSource(PriceSource):
    def __init__(
        self, ticker_factory: Callable[[str], _TickerLike] = yf.Ticker
    ) -> None:
        self._ticker_factory = ticker_factory

    def fetch_history(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        ticker = self._ticker_factory(symbol)
        # yfinance's `end` is exclusive — add a day so the requested end
        # date's own bar is included.
        history = ticker.history(
            start=start.isoformat(), end=(end + timedelta(days=1)).isoformat()
        )
        bars = []
        for index, row in history.iterrows():
            bars.append(PriceBar(date=index.date(), close=Decimal(str(row["Close"]))))
        return bars
