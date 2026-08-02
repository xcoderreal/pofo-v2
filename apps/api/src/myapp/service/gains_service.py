"""Realized and unrealized gain, computed on read — never stored.

Realized gain is pure FIFO/Lot math (see domain/position.py) and needs no
price lookup at all: it's fully determined by the opening and closing
price of each matched lot, which the transaction ledger already has.
Unrealized gain needs one more fact the ledger doesn't have — the latest
market price for the open shares — so this composes TransactionService
(for the Position) with PriceService (for that price), the same
"service composes service" shape CashService established in #9.
"""

from dataclasses import dataclass
from decimal import Decimal

from myapp.domain.position import realized_gain_events
from myapp.service.price_service import PriceService
from myapp.service.transaction_service import TransactionService


@dataclass
class GainsService:
    transaction_service: TransactionService
    price_service: PriceService

    def get_realized_gain(
        self, account_id: str, instrument_id: str, user_id: str
    ) -> Decimal | None:
        position = self.transaction_service.get_position(
            account_id, instrument_id, user_id=user_id
        )
        if position is None:
            return None
        return position.realized_gain

    def get_realized_gain_by_transaction(
        self, account_id: str, instrument_id: str, user_id: str
    ) -> dict[str, Decimal] | None:
        """Realized gain attributed to each *closing* transaction, keyed by
        its id. None when the account isn't the user's; `{}` when nothing
        has been closed.

        The Activity ledger shows realized gain on the sell that booked it
        (docs/design/dashboard_v2/behaviour.md § Activity), and
        `get_realized_gain` above can't answer that — it is the position's
        lifetime total, so three sells of the same holding would each
        render the same figure.

        One SELL can close several lots at once under FIFO, so the per-lot
        events are summed per closing transaction rather than being
        returned raw. That fold is the whole reason this lives here beside
        the other gain rules instead of at the call site.
        """
        position = self.transaction_service.get_position(
            account_id, instrument_id, user_id=user_id
        )
        if position is None:
            return None

        totals: dict[str, Decimal] = {}
        for closing_transaction, gain in realized_gain_events(position.lots):
            totals[closing_transaction.id] = (
                totals.get(closing_transaction.id, Decimal(0)) + gain
            )
        return totals

    def get_unrealized_gain(
        self, account_id: str, instrument_id: str, user_id: str
    ) -> Decimal | None:
        position = self.transaction_service.get_position(
            account_id, instrument_id, user_id=user_id
        )
        if position is None:
            return None
        if position.share_count == 0:
            return Decimal(0)

        latest_price = self.price_service.get_latest_price(instrument_id)
        if latest_price is None:
            return None

        return position.unrealized_gain(latest_price.close)
