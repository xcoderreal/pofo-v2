from abc import ABC, abstractmethod


class PriceSource(ABC):
    @abstractmethod
    def get_price(self, ticker: str) -> float | None:
        """Return the current price for a ticker, or None if unavailable."""
        ...

    @abstractmethod
    def get_prices(self, tickers: list[str]) -> dict[str, float]:
        """Return current prices for multiple tickers. Missing tickers omitted."""
        ...
