from myapp.domain.model import Account, Instrument
from myapp.domain.repository import AccountRepository, InstrumentRepository


class MemoryInstrumentRepository(InstrumentRepository):
    """In-memory repository.

    Useful for development and as a reference implementation.
    """

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


class MemoryAccountRepository(AccountRepository):
    """In-memory repository.

    get() is intentionally unscoped by user — ownership is enforced by the
    service layer (see AccountService), mirroring how a real Supabase-backed
    adapter's RLS policy would make cross-user rows invisible at the query
    layer rather than requiring the adapter to filter explicitly.
    """

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
