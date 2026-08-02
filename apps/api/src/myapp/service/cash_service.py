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

Insufficient cash for a trade isn't a distinct *check* — the paired CASH
SELL goes through the identical FIFO overdraw check as selling too many
shares of any other instrument. It is a distinct *diagnosis*, though, so
log_trade re-labels an overdraw that landed on the cash leg as
InsufficientCashError (a subclass, so nothing that catches the base class
changes behaviour). Cash cannot go negative; there is no margin mode.

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
from myapp.domain.position import InsufficientSharesError
from myapp.service.instrument_service import (
    DuplicateIdError,
    InstrumentService,
)
from myapp.service.transaction_service import TransactionService

CASH_INSTRUMENT_ID = "cash"
CASH_SYMBOL = "USD"


class InsufficientCashError(InsufficientSharesError):
    """The overdraw was on the CASH position — the account cannot pay for
    this trade (or fund this withdrawal).

    A *subclass*, because mechanically it is the very same FIFO overdraw
    and nothing about the check is new (docs/adr/0001-dashboard-v2.md § 4)
    — so every existing `except InsufficientSharesError` keeps working. But
    a distinguishable one, because the remedy is not the same: an over-sell
    is fixed by selling fewer units, while a trade rejected for cash is
    fixed by recording the funding Deposit that belongs *before* it in the
    ledger. That ordering requirement is the stated consequence of § 4, and
    a caller that can only see one error type cannot point at it.

    Raised only by `log_trade`, which is the one place that knows which of
    the two legs it wrote is the cash side.
    """

    def __init__(
        self, *, account_id: str, requested: Decimal, available: Decimal
    ) -> None:
        super().__init__(
            account_id=account_id,
            instrument_id=CASH_INSTRUMENT_ID,
            requested=requested,
            available=available,
            message=(
                f"Account {account_id!r} holds {available} in cash, "
                f"but this needs {requested} — record the funding deposit "
                f"before the transaction it pays for"
            ),
        )


def _as_cash_error(exc: InsufficientSharesError) -> InsufficientSharesError:
    """Re-label an overdraw that landed on the CASH position; pass anything
    else through untouched."""
    if exc.instrument_id != CASH_INSTRUMENT_ID:
        return exc
    return InsufficientCashError(
        account_id=exc.account_id,
        requested=exc.requested,
        available=exc.available,
    )


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
            try:
                return self.transaction_service.log_transaction(transaction)
            except InsufficientSharesError as exc:
                # A withdrawal larger than the balance. Same overdraw, and
                # the same thing to say about it as a trade's cash leg.
                raise _as_cash_error(exc) from exc

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
        try:
            self.transaction_service.log_transactions([primary, cash_leg])
        except InsufficientSharesError as exc:
            # Either leg can overdraw — the instrument leg on an over-sell,
            # the cash leg on a buy the account can't pay for — and only
            # the exception's own instrument says which.
            raise _as_cash_error(exc) from exc
        return primary
