from myapp.domain.model import Account, Instrument, Transaction
from myapp.domain.repository import (
    AccountRepository,
    InstrumentRepository,
    TransactionRepository,
)


class MemoryAccountRepository(AccountRepository):
    def __init__(self, accounts: list[Account] | None = None):
        self._accounts: list[Account] = list(accounts or [])

    def list_all(self) -> list[Account]:
        return list(self._accounts)

    def get(self, account_id: str) -> Account | None:
        for acct in self._accounts:
            if acct.id == account_id:
                return acct
        return None

    def add(self, account: Account) -> None:
        self._accounts.append(account)

    def delete(self, account_id: str) -> bool:
        for i, acct in enumerate(self._accounts):
            if acct.id == account_id:
                self._accounts.pop(i)
                return True
        return False


class MemoryInstrumentRepository(InstrumentRepository):
    def __init__(self, instruments: list[Instrument] | None = None):
        self._instruments: list[Instrument] = list(instruments or [])

    def list_all(self) -> list[Instrument]:
        return list(self._instruments)

    def get(self, instrument_id: str) -> Instrument | None:
        for inst in self._instruments:
            if inst.id == instrument_id:
                return inst
        return None

    def add(self, instrument: Instrument) -> None:
        self._instruments.append(instrument)

    def delete(self, instrument_id: str) -> bool:
        for i, inst in enumerate(self._instruments):
            if inst.id == instrument_id:
                self._instruments.pop(i)
                return True
        return False


class MemoryTransactionRepository(TransactionRepository):
    def __init__(self, transactions: list[Transaction] | None = None):
        self._transactions: list[Transaction] = list(transactions or [])

    def list_all(self) -> list[Transaction]:
        return list(self._transactions)

    def get(self, transaction_id: str) -> Transaction | None:
        for txn in self._transactions:
            if txn.id == transaction_id:
                return txn
        return None

    def add(self, transaction: Transaction) -> None:
        self._transactions.append(transaction)

    def delete(self, transaction_id: str) -> bool:
        for i, txn in enumerate(self._transactions):
            if txn.id == transaction_id:
                self._transactions.pop(i)
                return True
        return False

    def list_by_account(self, account_id: str) -> list[Transaction]:
        return [t for t in self._transactions if t.account_id == account_id]

    def list_by_instrument(self, instrument_id: str) -> list[Transaction]:
        return [t for t in self._transactions if t.instrument_id == instrument_id]
