"""Every computed Position across a scope, in one call.

Most of the dashboard is *current state*, not a series: the Holdings and
Accounts lists, the instrument stat card, the Grid matrix. Served through
`query_timeseries` with `start = end = today` a single screen costs ~5
round trips and the Grid ~8-11 — and the matrix isn't expressible at all,
being two-dimensional while `GroupBy` is single-valued. So the client
reads these rows once and pivots them for every list
(docs/adr/0001-dashboard-v2.md § 5).

This is not a new architectural direction: the single-pair position
endpoint from #8 already returns this shape for one (Account, Instrument)
— this is that shape batched, with the price-derived fields the lists
need. `query_timeseries` keeps charts and sparklines.

Composes TransactionService (for the Position), GainsService (for
realized/unrealized) and PriceService (for market value) rather than
repositories — the same "service composes service" shape CashService
established in #9. In particular the gain semantics stay in exactly one
place: "no price yet -> None" and "no shares -> zero" are GainsService's
rules, not re-decided here.

**CASH is included.** The Accounts list shows an account's value
*including* cash and the Grid's total tile is `equity + cash_balance`, so
both need the CASH row. That's not in tension with
docs/adr/0001-dashboard-v2.md § 3, which excludes CASH from `"all"` for
the *summed-dollar time-series metrics* precisely so that
`equity + cash_balance` doesn't double-count; here the two live in
separate, per-instrument rows and the client adds them deliberately.
Filtering CASH out of the Holdings list is the client's job.

Each row recomputes its Position up to three times (once here, once
inside each GainsService call). That's deliberate: FIFO over one
account/instrument ledger is sub-millisecond at single-user scale and
caching computed Position/Lot/gains is an explicit non-goal
(docs/non-goals.md).
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from myapp.service.account_service import AccountService
from myapp.service.gains_service import GainsService
from myapp.service.instrument_service import InstrumentService
from myapp.service.price_service import PriceService
from myapp.service.transaction_service import TransactionService

# Same convention as the time-series query's scope params: omitted, or an
# explicit-but-non-narrowing "all", both mean "no filter on this
# dimension" (service/query_service.py).
Scope = list[str] | Literal["all"] | None


@dataclass(frozen=True)
class PositionRow:
    """One computed Position, keyed by (account, instrument).

    `average_cost` is None for a fully closed position — dividing a zero
    cost basis by zero shares has no answer, and a fabricated 0 would
    render as a real average price paid. `market_value` and
    `unrealized_gain` are None when the instrument has no price history
    yet, which the client renders as a pending/dash state rather than as
    a $0 holding.
    """

    account_id: str
    instrument_id: str
    share_count: Decimal
    cost_basis: Decimal
    average_cost: Decimal | None
    market_value: Decimal | None
    realized_gain: Decimal
    unrealized_gain: Decimal | None


def _is_unconstrained(scope: Scope) -> bool:
    return scope is None or scope == "all" or scope == ["all"]


@dataclass
class PositionsService:
    account_service: AccountService
    instrument_service: InstrumentService
    transaction_service: TransactionService
    gains_service: GainsService
    price_service: PriceService

    def list_positions(
        self,
        *,
        user_id: str,
        accounts: Scope = None,
        instruments: Scope = None,
    ) -> list[PositionRow]:
        """Rows for every (account, instrument) pair in scope that has any
        transaction history. Pairs the user never traded are omitted
        rather than returned as zero rows — the cross product of accounts
        and the instrument catalog is mostly empty.

        A fully closed position (zero shares, non-zero realized gain) IS
        returned: the Holdings list separates those into their own
        disclosure, so it needs them.
        """
        account_ids = self._resolve_accounts(user_id, accounts)
        instrument_ids = self._resolve_instruments(instruments)

        rows = []
        for account_id in account_ids:
            for instrument_id in instrument_ids:
                row = self._row(user_id, account_id, instrument_id)
                if row is not None:
                    rows.append(row)
        return rows

    # ─── Scope resolution ────────────────────────────────────────
    # Ids the user doesn't own (or that don't exist) are intersected away
    # rather than raising — the same treatment query_service gives them,
    # so a stale client filter degrades to "fewer rows", not a 404.

    def _resolve_accounts(self, user_id: str, accounts: Scope) -> list[str]:
        owned_ids = {a.id for a in self.account_service.list_accounts(user_id)}
        if _is_unconstrained(accounts):
            return sorted(owned_ids)
        return sorted(owned_ids & set(accounts))

    def _resolve_instruments(self, instruments: Scope) -> list[str]:
        catalog_ids = {i.id for i in self.instrument_service.list_instruments()}
        if _is_unconstrained(instruments):
            return sorted(catalog_ids)
        return sorted(catalog_ids & set(instruments))

    # ─── Per-pair computation ───────────────────────────────────

    def _row(
        self, user_id: str, account_id: str, instrument_id: str
    ) -> PositionRow | None:
        position = self.transaction_service.get_position(
            account_id, instrument_id, user_id=user_id
        )
        if position is None or not position.lots:
            return None

        share_count = position.share_count
        cost_basis = position.cost_basis

        if share_count == 0:
            # No price lookup at all for a closed position — its market
            # value is zero by definition, which is what keeps a fully
            # closed row renderable before any price has been fetched.
            average_cost: Decimal | None = None
            market_value: Decimal | None = Decimal(0)
        else:
            average_cost = cost_basis / share_count
            latest = self.price_service.get_latest_price(instrument_id)
            market_value = None if latest is None else share_count * latest.close

        # get_position having returned a Position already proves the
        # account exists and is owned, so neither gains call can return
        # the None it uses for "not yours" — only get_unrealized_gain's
        # other None, "no price data yet", is reachable here.
        realized_gain = self.gains_service.get_realized_gain(
            account_id, instrument_id, user_id=user_id
        )
        unrealized_gain = self.gains_service.get_unrealized_gain(
            account_id, instrument_id, user_id=user_id
        )

        return PositionRow(
            account_id=account_id,
            instrument_id=instrument_id,
            share_count=share_count,
            cost_basis=cost_basis,
            average_cost=average_cost,
            market_value=market_value,
            realized_gain=Decimal(0) if realized_gain is None else realized_gain,
            unrealized_gain=unrealized_gain,
        )
