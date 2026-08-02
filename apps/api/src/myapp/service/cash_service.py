"""Keeps the CASH position consistent with everything else that touches
an account's money: Deposit/Withdrawal, and — per UBIQUITOUS_LANGUAGE.md's
Cash Balance entry ("the implicit cash leg of every non-cash BUY/SELL")
— ordinary trades too. `log_trade()` is the one entry point: a Deposit,
Withdrawal, or trade of any instrument all flow through it.

There is no separate cash ledger — a deposit is a BUY of CASH at price 1,
a withdrawal is a SELL of it, a BUY of any other instrument pairs with a
CASH SELL of equal value (what you paid), a SELL pairs with a CASH BUY
(the proceeds) — and all of these are validated and persisted through the
exact same TransactionService path any other trade uses, just as a
same-or-fail batch when a pairing is involved (TransactionService.
log_transactions). This is why cost_basis == share_count and
realized_gain == 0 fall out of the shared FIFO math for CASH positions
for free: every CASH transaction prices at exactly 1, so a lot's opening
and closing price are always equal — that holds regardless of whether the
CASH transaction came from a Deposit/Withdrawal or a trade's paired leg.

CashService composes TransactionService AND InstrumentService rather than
repositories directly — the first instance of "service composes service"
in this codebase. Auto-provisioning the CASH instrument goes through
InstrumentService.create_instrument(), not the repository directly, so
it's covered by the same symbol-uniqueness enforcement as any other
instrument creation — writing straight to the repo would let a
already-existing "USD" instrument (created by a user under a different
id via POST /instruments, however unlikely) silently coexist with a
second CASH row instead of surfacing the conflict.

Insufficient cash for a trade isn't a distinct concept — the paired CASH
SELL goes through the identical FIFO overdraw check as selling too many
shares of any other instrument, and raises the same InsufficientSharesError.
Cash cannot go negative; there is no margin/negative-balance mode.

Known gap: the get-then-create-if-missing check in _ensure_cash_instrument
is not atomic. Two concurrent first-writes could both observe "not
found" and both attempt creation; the second attempt's DuplicateIdError
is caught as an already-provisioned signal, so this doesn't produce two
CASH rows — but it's a real, untested race under the in-memory adapter's
lack of locking. Expected to be closed by a real database's unique
constraint on symbol once a non-memory repository exists, not by
application-level locking now.
"""

from dataclasses import dataclass, replace
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
        return self.log_trade(
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
        return self.log_trade(
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

    def log_trade(self, transaction: Transaction) -> Transaction:
        """The one entry point for writing any transaction on this
        ledger. A transaction of the CASH instrument itself (a
        Deposit/Withdrawal) is passed straight through, unpaired — its
        trade_id stays None. Any other instrument's BUY/SELL is paired
        with an automatic CASH leg of equal value in the same account —
        a BUY debits cash (a CASH SELL of what you paid), a SELL
        credits it (a CASH BUY of the proceeds) — written atomically
        alongside the trade itself via TransactionService.
        log_transactions. Both legs carry the same trade_id: the
        primary leg's own id, so a paired CASH row can be correlated
        back to its trade (and filtered out of a raw transaction list)
        without matching on account/timestamp/amount, which collides on
        same-day trades of equal value."""
        self._ensure_cash_instrument()
        if transaction.instrument_id == CASH_INSTRUMENT_ID:
            return self.transaction_service.log_transaction(transaction)

        primary = replace(transaction, trade_id=transaction.id)
        cash_leg = Transaction(
            id=f"{transaction.id}-cash",
            user_id=transaction.user_id,
            account_id=transaction.account_id,
            instrument_id=CASH_INSTRUMENT_ID,
            type=(
                TransactionType.SELL
                if transaction.type == TransactionType.BUY
                else TransactionType.BUY
            ),
            quantity=transaction.quantity * transaction.price,
            price=Decimal(1),
            timestamp=transaction.timestamp,
            trade_id=transaction.id,
        )
        self.transaction_service.log_transactions([primary, cash_leg])
        return primary
