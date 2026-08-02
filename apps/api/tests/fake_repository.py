from datetime import date, datetime

from myapp.domain.model import Account, Instrument, Transaction
from myapp.domain.price import PriceBar
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    PriceHistoryRepository,
    TransactionRepository,
)


class FakeInstrumentRepository(InstrumentRepository):
    def __init__(self, instruments: list[Instrument] | None = None):
        self._instruments: list[Instrument] = list(instruments or [])

    def list_all(self) -> list[Instrument]:
        return list(self._instruments)

    def get(self, instrument_id: str) -> Instrument | None:
        for instrument in self._instruments:
            if instrument.id == instrument_id:
                return instrument
        return None

    def get_by_symbol(self, symbol: str) -> Instrument | None:
        for instrument in self._instruments:
            if instrument.symbol == symbol.upper():
                return instrument
        return None

    def add(self, instrument: Instrument) -> None:
        self._instruments.append(instrument)


class FakeAccountRepository(AccountRepository):
    def __init__(self, accounts: list[Account] | None = None):
        self._accounts: list[Account] = list(accounts or [])

    def list_by_user(self, user_id: str) -> list[Account]:
        return [a for a in self._accounts if a.user_id == user_id]

    def get(self, account_id: str) -> Account | None:
        for account in self._accounts:
            if account.id == account_id:
                return account
        return None

    def add(self, account: Account) -> None:
        self._accounts.append(account)


class FakeTransactionRepository(TransactionRepository):
    def __init__(self, transactions: list[Transaction] | None = None):
        self._transactions: list[Transaction] = list(transactions or [])

    def list_by_account_instrument(
        self, account_id: str, instrument_id: str
    ) -> list[Transaction]:
        return [
            t
            for t in self._transactions
            if t.account_id == account_id and t.instrument_id == instrument_id
        ]

    def list_by_account(self, account_id: str) -> list[Transaction]:
        return [t for t in self._transactions if t.account_id == account_id]

    def add(self, transaction: Transaction) -> None:
        self._transactions.append(transaction)


class FakePriceHistoryRepository(PriceHistoryRepository):
    def __init__(self) -> None:
        self._bars: dict[str, list[PriceBar]] = {}
        self._last_fetched_at: dict[str, datetime] = {}
        self._backfill_floor: dict[str, date] = {}

    def get_bars(self, instrument_id: str) -> list[PriceBar]:
        return list(self._bars.get(instrument_id, []))

    def add_bars(self, instrument_id: str, bars: list[PriceBar]) -> None:
        self._bars.setdefault(instrument_id, []).extend(bars)

    def get_last_fetched_at(self, instrument_id: str) -> datetime | None:
        return self._last_fetched_at.get(instrument_id)

    def set_last_fetched_at(self, instrument_id: str, when: datetime) -> None:
        self._last_fetched_at[instrument_id] = when

    def get_backfill_floor(self, instrument_id: str) -> date | None:
        return self._backfill_floor.get(instrument_id)

    def set_backfill_floor(self, instrument_id: str, start: date) -> None:
        self._backfill_floor[instrument_id] = start
