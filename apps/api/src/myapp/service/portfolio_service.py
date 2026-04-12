from dataclasses import dataclass
from datetime import date

from myapp.domain.model import (
    Account,
    DailyValue,
    Instrument,
    Position,
    RealizedGain,
    Transaction,
    TransactionType,
)
from myapp.domain.portfolio import (
    compute_lots_and_gains,
    compute_positions,
    compute_positions_by_instrument,
    compute_realized_gains,
)
from myapp.domain.price_source import PriceSource
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    TransactionRepository,
)


@dataclass
class PortfolioService:
    account_repo: AccountRepository
    instrument_repo: InstrumentRepository
    transaction_repo: TransactionRepository
    price_source: PriceSource

    # ─── Accounts ─────────────────────────────────────────────

    def list_accounts(self) -> list[Account]:
        return self.account_repo.list_all()

    def get_account(self, account_id: str) -> Account | None:
        return self.account_repo.get(account_id)

    def create_account(self, account: Account) -> Account:
        self.account_repo.add(account)
        return account

    def delete_account(self, account_id: str) -> bool:
        return self.account_repo.delete(account_id)

    # ─── Instruments ──────────────────────────────────────────

    def list_instruments(self) -> list[Instrument]:
        return self.instrument_repo.list_all()

    def get_instrument(self, instrument_id: str) -> Instrument | None:
        return self.instrument_repo.get(instrument_id)

    def create_instrument(self, instrument: Instrument) -> Instrument:
        self.instrument_repo.add(instrument)
        return instrument

    def delete_instrument(self, instrument_id: str) -> bool:
        return self.instrument_repo.delete(instrument_id)

    # ─── Transactions ─────────────────────────────────────────

    def list_transactions(
        self,
        account_id: str | None = None,
        instrument_id: str | None = None,
    ) -> list[Transaction]:
        if account_id and instrument_id:
            txns = self.transaction_repo.list_by_account(account_id)
            return [t for t in txns if t.instrument_id == instrument_id]
        if account_id:
            return self.transaction_repo.list_by_account(account_id)
        if instrument_id:
            return self.transaction_repo.list_by_instrument(instrument_id)
        return self.transaction_repo.list_all()

    def get_transaction(self, transaction_id: str) -> Transaction | None:
        return self.transaction_repo.get(transaction_id)

    def create_transaction(self, transaction: Transaction) -> Transaction:
        if transaction.type == TransactionType.SELL:
            self._validate_sell(transaction)
        self.transaction_repo.add(transaction)
        return transaction

    def delete_transaction(self, transaction_id: str) -> bool:
        return self.transaction_repo.delete(transaction_id)

    def _validate_sell(self, sell: Transaction) -> None:
        """Ensure you can't sell more shares than you hold (FIFO)."""
        txns = self.transaction_repo.list_by_account(sell.account_id)
        txns = [t for t in txns if t.instrument_id == sell.instrument_id]
        lots, _ = compute_lots_and_gains(txns)
        available = sum(lot.quantity for lot in lots)
        if sell.quantity > available + 1e-9:
            raise ValueError(
                f"Cannot sell {sell.quantity} shares; only {available} available"
            )

    # ─── Positions (computed) ─────────────────────────────────

    def get_positions(
        self,
        account_id: str | None = None,
        instrument_id: str | None = None,
    ) -> list[Position]:
        txns = self.transaction_repo.list_all()
        tickers = self._ticker_map()
        instrument_ids = {t.instrument_id for t in txns}
        ticker_list = [tickers[iid] for iid in instrument_ids if iid in tickers]
        prices_by_ticker = self.price_source.get_prices(ticker_list)
        prices = {
            iid: prices_by_ticker[ticker]
            for iid, ticker in tickers.items()
            if ticker in prices_by_ticker
        }

        if account_id is None and instrument_id is not None:
            return compute_positions_by_instrument(txns, prices, instrument_id)
        if account_id is None and instrument_id is None:
            return compute_positions_by_instrument(txns, prices)
        return compute_positions(txns, prices, account_id, instrument_id)

    # ─── Capital gains (computed) ─────────────────────────────

    def get_realized_gains(
        self,
        account_id: str | None = None,
        instrument_id: str | None = None,
    ) -> list[RealizedGain]:
        txns = self.transaction_repo.list_all()
        return compute_realized_gains(txns, account_id, instrument_id)

    # ─── Portfolio value over time ────────────────────────────

    def get_portfolio_history(
        self,
        account_id: str | None = None,
    ) -> list[DailyValue]:
        """Compute daily portfolio value from transaction history.

        Returns one entry per day where a transaction occurred, showing
        cumulative cost basis and market value at each point.
        """
        txns = self.transaction_repo.list_all()
        if account_id:
            txns = [t for t in txns if t.account_id == account_id]

        if not txns:
            return []

        sorted_txns = sorted(txns, key=lambda t: t.date)
        tickers = self._ticker_map()
        instrument_ids = {t.instrument_id for t in txns}
        ticker_list = [tickers[iid] for iid in instrument_ids if iid in tickers]
        prices_by_ticker = self.price_source.get_prices(ticker_list)
        prices = {
            iid: prices_by_ticker[ticker]
            for iid, ticker in tickers.items()
            if ticker in prices_by_ticker
        }

        seen_dates: dict[date, int] = {}
        for i, txn in enumerate(sorted_txns):
            seen_dates[txn.date] = i

        history: list[DailyValue] = []
        for d in sorted(seen_dates.keys()):
            txns_up_to = [t for t in sorted_txns if t.date <= d]
            positions = compute_positions_by_instrument(txns_up_to, prices)
            cost = sum(p.cost_basis for p in positions)
            mkt = sum(p.market_value for p in positions if p.market_value is not None)
            history.append(DailyValue(date=d, market_value=mkt, cost_basis=cost))

        return history

    def _ticker_map(self) -> dict[str, str]:
        """Build instrument_id -> ticker mapping."""
        return {inst.id: inst.ticker for inst in self.instrument_repo.list_all()}
