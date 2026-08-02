"""The raw Transaction feed behind the Activity tab, newest first.

Two things separate this from the batched positions endpoint (#16), which
is otherwise the closest neighbour: it returns *events* rather than
computed state, and it deliberately returns **every** row, including the
CASH leg auto-posted alongside each trade.

That last part is the load-bearing decision. `Transaction.trade_id` is a
stored field (docs/adr/0001-dashboard-v2.md § 2), and the Activity feed's
suppression rule — hide a CASH row that carries one, show a CASH row that
doesn't, because the latter is a genuine Deposit or Withdrawal — is a
predicate on that field. Applying it here would leave the client unable to
tell the two apart at all, and would tempt a future client into
re-deriving the pairing from account/timestamp/amount, which collides on
same-day trades of equal value. So the server ships the fact and the
client renders the rule.

Realized gain rides along per entry because Activity shows it on the sell
that booked it. It comes from GainsService, which owns every gain rule in
this codebase, rather than from a second fold over lots here.

Composes AccountService, InstrumentService, TransactionService and
GainsService — the "service composes service" shape CashService
established in #9 and PositionsService extended in #16 — so scope
resolution and gain semantics stay in exactly one place each.
"""

from dataclasses import dataclass
from decimal import Decimal

from myapp.domain.model import Transaction, TransactionType
from myapp.domain.query import Scope, is_unconstrained
from myapp.service.account_service import AccountService
from myapp.service.gains_service import GainsService
from myapp.service.instrument_service import InstrumentService
from myapp.service.transaction_service import TransactionService


@dataclass(frozen=True)
class LedgerEntry:
    """One Transaction, plus the gain it booked.

    `realized_gain` is None for a BUY — opening a lot books nothing, and a
    0 there would render as "broke even" beside every purchase. For a SELL
    it is the sum over every lot that sell closed, which is why it can't be
    read off the Position (that figure is the instrument's lifetime total,
    shared by all of its sells).
    """

    transaction: Transaction
    realized_gain: Decimal | None


@dataclass
class LedgerService:
    account_service: AccountService
    instrument_service: InstrumentService
    transaction_service: TransactionService
    gains_service: GainsService

    def list_entries(
        self,
        *,
        user_id: str,
        accounts: Scope = None,
        instruments: Scope = None,
    ) -> list[LedgerEntry]:
        """Newest first, across the requested scope.

        Ordering is the service's job rather than the client's because
        "newest first" is what the feed *is*; the client groups the result
        into months, which is a presentation concern and stays there.

        Ties are broken by transaction id so a batch written at one
        timestamp — a trade and its paired CASH leg, or a seed fixture —
        has a stable order instead of one that depends on repository
        iteration.
        """
        account_ids = self._resolve_accounts(user_id, accounts)
        instrument_filter = self._resolve_instruments(instruments)

        entries: list[LedgerEntry] = []
        for account_id in account_ids:
            transactions = self.transaction_service.list_by_account(
                account_id, user_id=user_id
            )
            if transactions is None:
                continue
            in_scope = [
                t
                for t in transactions
                if instrument_filter is None or t.instrument_id in instrument_filter
            ]
            entries.extend(self._entries_for(user_id, account_id, in_scope))

        entries.sort(
            key=lambda e: (e.transaction.timestamp, e.transaction.id), reverse=True
        )
        return entries

    # ─── Scope resolution ────────────────────────────────────────
    # Ids the user doesn't own (or that don't exist) are intersected away
    # rather than raising, exactly as PositionsService and QueryService
    # treat them — a stale client filter degrades to "fewer rows", not a
    # 404.

    def _resolve_accounts(self, user_id: str, accounts: Scope) -> list[str]:
        owned_ids = {a.id for a in self.account_service.list_accounts(user_id)}
        if is_unconstrained(accounts):
            return sorted(owned_ids)
        return sorted(owned_ids & set(accounts))

    def _resolve_instruments(self, instruments: Scope) -> set[str] | None:
        """None means "no filter" — distinct from an empty set, which is a
        filter naming only instruments that don't exist and correctly
        matches nothing."""
        if is_unconstrained(instruments):
            return None
        catalog_ids = {i.id for i in self.instrument_service.list_instruments()}
        return catalog_ids & set(instruments)

    # ─── Per-account gain attribution ────────────────────────────

    def _entries_for(
        self, user_id: str, account_id: str, transactions: list[Transaction]
    ) -> list[LedgerEntry]:
        """One GainsService call per instrument touched in this account,
        not one per transaction: attributing a sell's gain means running
        FIFO over that instrument's whole ledger anyway, so the per-sell
        figures all fall out of a single pass."""
        gains_by_instrument: dict[str, dict[str, Decimal]] = {}
        for instrument_id in {t.instrument_id for t in transactions}:
            gains = self.gains_service.get_realized_gain_by_transaction(
                account_id, instrument_id, user_id=user_id
            )
            gains_by_instrument[instrument_id] = gains or {}

        return [
            LedgerEntry(
                transaction=t,
                realized_gain=(
                    None
                    if t.type == TransactionType.BUY
                    else gains_by_instrument[t.instrument_id].get(t.id, Decimal(0))
                ),
            )
            for t in transactions
        ]
