from datetime import date
from decimal import Decimal

import pandas as pd

from myapp.adapters.yfinance_price_source import YFinancePriceSource
from myapp.domain.price import PriceBar


class _FakeTicker:
    """Mimics yfinance's Ticker.history() shape with a real, small pandas
    DataFrame — the same object shape the adapter actually iterates over,
    just never fetched over the network."""

    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame
        self.history_calls: list[tuple[str, str]] = []

    def history(self, start: str, end: str) -> pd.DataFrame:
        self.history_calls.append((start, end))
        return self._frame


def _frame(rows: list[tuple[str, float]]) -> pd.DataFrame:
    index = pd.to_datetime([r[0] for r in rows])
    return pd.DataFrame({"Close": [r[1] for r in rows]}, index=index)


def test_maps_rows_to_price_bars_with_decimal_close() -> None:
    frame = _frame([("2026-01-05", 100.5), ("2026-01-06", 101.25)])
    fake_ticker = _FakeTicker(frame)
    source = YFinancePriceSource(ticker_factory=lambda symbol: fake_ticker)

    bars = source.fetch_history("GOOG", date(2026, 1, 5), date(2026, 1, 6))

    assert bars == [
        PriceBar(date=date(2026, 1, 5), close=Decimal("100.5")),
        PriceBar(date=date(2026, 1, 6), close=Decimal("101.25")),
    ]


def test_end_date_is_made_inclusive_for_the_underlying_client() -> None:
    """yfinance's own `end` param is exclusive — the adapter must add a
    day so a request for [start, end] actually includes end's bar."""
    fake_ticker = _FakeTicker(_frame([]))
    source = YFinancePriceSource(ticker_factory=lambda symbol: fake_ticker)

    source.fetch_history("GOOG", date(2026, 1, 5), date(2026, 1, 6))

    assert fake_ticker.history_calls == [("2026-01-05", "2026-01-07")]


def test_uses_the_requested_symbol() -> None:
    seen_symbols = []

    def factory(symbol: str) -> _FakeTicker:
        seen_symbols.append(symbol)
        return _FakeTicker(_frame([]))

    source = YFinancePriceSource(ticker_factory=factory)
    source.fetch_history("BTC-USD", date(2026, 1, 5), date(2026, 1, 6))

    assert seen_symbols == ["BTC-USD"]


def test_empty_history_returns_an_empty_list() -> None:
    fake_ticker = _FakeTicker(_frame([]))
    source = YFinancePriceSource(ticker_factory=lambda symbol: fake_ticker)

    bars = source.fetch_history("GOOG", date(2026, 1, 5), date(2026, 1, 6))

    assert bars == []
