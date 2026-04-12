"""Yahoo Finance price source with TTL caching.

Uses yfinance's download API via httpx for simplicity. The cache lives
in the adapter (not the service layer), per architecture.md.

Constructor-injectable client + clock for unit testing.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import httpx

from myapp.domain.price_source import PriceSource

_DEFAULT_TTL = 300.0  # 5 minutes


class YahooPriceSource(PriceSource):
    def __init__(
        self,
        client: httpx.Client | None = None,
        ttl: float = _DEFAULT_TTL,
        now_fn: Callable[[], float] = time.monotonic,
    ):
        self._client = client or httpx.Client(timeout=10.0)
        self._ttl = ttl
        self._now_fn = now_fn
        self._cache: dict[str, tuple[float, float]] = {}  # ticker -> (price, timestamp)

    def get_price(self, ticker: str) -> float | None:
        cached = self._get_cached(ticker)
        if cached is not None:
            return cached

        try:
            price = self._fetch_price(ticker)
            if price is not None:
                self._cache[ticker] = (price, self._now_fn())
            return price
        except (httpx.HTTPError, KeyError, ValueError, IndexError):
            return None

    def get_prices(self, tickers: list[str]) -> dict[str, float]:
        result: dict[str, float] = {}
        to_fetch: list[str] = []

        for ticker in tickers:
            cached = self._get_cached(ticker)
            if cached is not None:
                result[ticker] = cached
            else:
                to_fetch.append(ticker)

        if to_fetch:
            fetched = self._fetch_prices_batch(to_fetch)
            now = self._now_fn()
            for ticker, price in fetched.items():
                self._cache[ticker] = (price, now)
                result[ticker] = price

        return result

    def _get_cached(self, ticker: str) -> float | None:
        if ticker in self._cache:
            price, ts = self._cache[ticker]
            if self._now_fn() - ts < self._ttl:
                return price
        return None

    def _fetch_price(self, ticker: str) -> float | None:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        resp = self._client.get(url, params={"interval": "1d", "range": "1d"})
        resp.raise_for_status()
        data = resp.json()
        meta = data["chart"]["result"][0]["meta"]
        return float(meta["regularMarketPrice"])

    def _fetch_prices_batch(self, tickers: list[str]) -> dict[str, float]:
        result: dict[str, float] = {}
        for ticker in tickers:
            try:
                price = self._fetch_price(ticker)
                if price is not None:
                    result[ticker] = price
            except (httpx.HTTPError, KeyError, ValueError, IndexError):
                continue
        return result
