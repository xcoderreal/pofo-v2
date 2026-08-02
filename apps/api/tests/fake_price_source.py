from datetime import date

from myapp.domain.price import PriceBar, PriceSource


class FakePriceSource(PriceSource):
    """Returns canned bars per symbol — never touches the network. Records
    every call so tests can assert on respectful/lazy fetch behavior
    (e.g. "a second request for already-covered data makes no call")."""

    def __init__(self, bars_by_symbol: dict[str, list[PriceBar]] | None = None):
        self._bars_by_symbol = bars_by_symbol or {}
        self.calls: list[tuple[str, date, date]] = []

    def fetch_history(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        self.calls.append((symbol, start, end))
        bars = self._bars_by_symbol.get(symbol, [])
        return [b for b in bars if start <= b.date <= end]
