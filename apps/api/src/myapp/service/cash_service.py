"""Deposit/Withdrawal, translated to Buy/Sell of the CASH instrument.

There is no separate cash ledger — a deposit is a BUY of CASH at price 1,
a withdrawal is a SELL of it, and both are validated and persisted through
the exact same TransactionService.log_transaction() path any other trade
uses. This is why cost_basis == share_count and (once computed, in a
later ticket) realized_gain == 0 fall out of the shared FIFO math for
CASH positions for free: every CASH transaction prices at exactly 1, so
a lot's opening and closing price are always equal.

CashService composes TransactionService AND InstrumentService rather than
repositories directly — the first instance of "service composes service"
in this codebase. Auto-provisioning the CASH instrument goes through
InstrumentService.create_instrument(), not the repository directly, so
it's covered by the same symbol-uniqueness enforcement as any other
instrument creation — writing straight to the repo would let a
already-existing "USD" instrument (created by a user under a different
id via POST /instruments, however unlikely) silently coexist with a
second CASH row instead of surfacing the conflict.

Known gap: the get-then-create-if-missing check in _ensure_cash_instrument
is not atomic. Two concurrent first-deposits could both observe "not
found" and both attempt creation; the second attempt's DuplicateIdError
is caught as an already-provisioned signal, so this doesn't produce two
CASH rows — but it's a real, untested race under the in-memory adapter's
lack of locking. Expected to be closed by a real database's unique
constraint on symbol once a non-memory repository exists, not by
application-level locking now.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from myapp.domain.model import AssetClass, Instrument, Transaction, TransactionType
from myapp.service.instrument_service import (
    DuplicateIdError,
    InstrumentService,
)
from myapp.service.transaction_service import TransactionService

CASH_INSTRUMENT_ID = "cash"
CASH_SYMBOL = "USD"


@dataclass
class CashService:
    transaction_service: TransactionService
    instrument_service: InstrumentService

    def _ensure_cash_instrument(self) -> None:
        if self.instrument_service.get_instrument(CASH_INSTRUMENT_ID) is not None:
            return
        try:
            self.instrument_service.create_instrument(
                Instrument(
                    id=CASH_INSTRUMENT_ID,
                    symbol=CASH_SYMBOL,
                    name="Cash",
                    asset_class=AssetClass.CASH,
                )
            )
        except DuplicateIdError:
            # A concurrent first-deposit already created it — fine, that's
            # the same outcome. DuplicateSymbolError is NOT caught here: it
            # means some other instrument already claims "USD" under a
            # different id, a genuine conflict that should surface rather
            # than silently coexist as a second CASH-like row.
            pass

    def deposit(
        self,
        *,
        id: str,
        user_id: str,
        account_id: str,
        amount: Decimal,
        timestamp: datetime,
    ) -> Transaction:
        self._ensure_cash_instrument()
        return self.transaction_service.log_transaction(
            Transaction(
                id=id,
                user_id=user_id,
                account_id=account_id,
                instrument_id=CASH_INSTRUMENT_ID,
                type=TransactionType.BUY,
                quantity=amount,
                price=Decimal(1),
                timestamp=timestamp,
            )
        )

    def withdraw(
        self,
        *,
        id: str,
        user_id: str,
        account_id: str,
        amount: Decimal,
        timestamp: datetime,
    ) -> Transaction:
        self._ensure_cash_instrument()
        return self.transaction_service.log_transaction(
            Transaction(
                id=id,
                user_id=user_id,
                account_id=account_id,
                instrument_id=CASH_INSTRUMENT_ID,
                type=TransactionType.SELL,
                quantity=amount,
                price=Decimal(1),
                timestamp=timestamp,
            )
        )
