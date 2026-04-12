from myapp.domain.price_source import PriceSource


class FakePriceSource(PriceSource):
    """In-memory price source for testing. Set prices via constructor or set_price()."""

    def __init__(self, prices: dict[str, float] | None = None):
        self._prices: dict[str, float] = dict(prices or {})

    def set_price(self, ticker: str, price: float) -> None:
        self._prices[ticker] = price

    def get_price(self, ticker: str) -> float | None:
        return self._prices.get(ticker)

    def get_prices(self, tickers: list[str]) -> dict[str, float]:
        return {t: self._prices[t] for t in tickers if t in self._prices}
