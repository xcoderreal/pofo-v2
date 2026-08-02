from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from myapp.domain.model import Transaction, TransactionType
from myapp.domain.position import (
    InsufficientSharesError,
    LotMatchingStrategy,
    LotMismatchError,
    compute_lots,
    compute_position,
    realized_gain_events,
)

T0 = datetime(2026, 1, 1)


def _buy(
    id: str, account_id: str, instrument_id: str, quantity: str, price: str, days: int
) -> Transaction:
    return Transaction(
        id=id,
        user_id="user-a",
        account_id=account_id,
        instrument_id=instrument_id,
        type=TransactionType.BUY,
        quantity=Decimal(quantity),
        price=Decimal(price),
        timestamp=T0 + timedelta(days=days),
    )


def _sell(
    id: str, account_id: str, instrument_id: str, quantity: str, price: str, days: int
) -> Transaction:
    return Transaction(
        id=id,
        user_id="user-a",
        account_id=account_id,
        instrument_id=instrument_id,
        type=TransactionType.SELL,
        quantity=Decimal(quantity),
        price=Decimal(price),
        timestamp=T0 + timedelta(days=days),
    )


class TestComputeLots:
    def test_a_single_buy_creates_one_open_lot(self) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)

        lots = compute_lots([buy])

        assert len(lots) == 1
        assert lots[0].quantity_remaining == Decimal("10")
        assert not lots[0].is_closed

    def test_a_sell_closes_the_oldest_lot_first(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "10", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "10", "150", days=1)
        sell = _sell("t3", "acc1", "goog", "10", "200", days=2)

        lots = compute_lots([buy1, buy2, sell])

        assert lots[0].is_closed  # the oldest lot (buy1) closed first
        assert lots[1].quantity_remaining == Decimal("10")  # buy2 untouched

    def test_a_sell_can_partially_close_a_lot(self) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell = _sell("t2", "acc1", "goog", "4", "150", days=1)

        lots = compute_lots([buy, sell])

        assert len(lots) == 1
        assert lots[0].quantity_remaining == Decimal("6")
        assert not lots[0].is_closed

    def test_a_sell_can_span_multiple_lots(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "5", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "5", "150", days=1)
        sell = _sell("t3", "acc1", "goog", "8", "200", days=2)

        lots = compute_lots([buy1, buy2, sell])

        assert lots[0].is_closed
        assert lots[1].quantity_remaining == Decimal("2")

    def test_chained_sells_across_three_lots_close_strictly_oldest_first(self) -> None:
        """3 lots of 5, then two sequential sells (8, then 4) — the second
        sell must continue from where the first left off, not restart or
        re-consider already-closed lots."""
        buy1 = _buy("t1", "acc1", "goog", "5", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "5", "150", days=1)
        buy3 = _buy("t3", "acc1", "goog", "5", "200", days=2)
        sell1 = _sell("t4", "acc1", "goog", "8", "300", days=3)
        sell2 = _sell("t5", "acc1", "goog", "4", "300", days=4)

        lots = compute_lots([buy1, buy2, buy3, sell1, sell2])

        assert lots[0].is_closed  # fully closed by sell1
        assert lots[1].is_closed  # 3 by sell1, remaining 2 by sell2
        assert lots[2].quantity_remaining == Decimal("3")  # 5 - 2 by sell2

    def test_selling_more_than_held_raises(self) -> None:
        buy = _buy("t1", "acc1", "goog", "5", "100", days=0)
        sell = _sell("t2", "acc1", "goog", "10", "200", days=1)

        with pytest.raises(InsufficientSharesError):
            compute_lots([buy, sell])

    def test_transactions_out_of_order_are_still_processed_chronologically(
        self,
    ) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell = _sell("t2", "acc1", "goog", "5", "200", days=1)

        # Passed in reverse order — compute_lots must sort by timestamp itself.
        lots = compute_lots([sell, buy])

        assert lots[0].quantity_remaining == Decimal("5")

    def test_non_fifo_strategy_raises_not_implemented(self) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)

        with pytest.raises(NotImplementedError):
            compute_lots([buy], strategy=LotMatchingStrategy.LIFO)

    def test_per_account_isolation_a_sale_in_one_account_cannot_close_a_lot_in_another(
        self,
    ) -> None:
        buy_in_brokerage = _buy("t1", "brokerage", "goog", "10", "100", days=0)
        sell_in_ira = _sell("t2", "ira", "goog", "5", "200", days=1)

        with pytest.raises(InsufficientSharesError):
            # No open lot exists in "ira" — the "brokerage" lot must not be
            # considered a candidate, even though it's the same instrument.
            compute_lots([buy_in_brokerage, sell_in_ira])

    def test_per_instrument_isolation_a_sale_cannot_close_another_symbols_lot(
        self,
    ) -> None:
        buy_goog = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell_aapl = _sell("t2", "acc1", "aapl", "5", "200", days=1)

        with pytest.raises(InsufficientSharesError):
            compute_lots([buy_goog, sell_aapl])


class TestLotClose:
    def test_close_raises_on_account_mismatch(self) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "brokerage", "goog", "10", "100", days=0)
        lot = Lot(opening_transaction=buy)
        mismatched_sell = _sell("t2", "ira", "goog", "5", "200", days=1)

        with pytest.raises(LotMismatchError):
            lot.close(mismatched_sell, Decimal("5"))

    def test_close_raises_on_instrument_mismatch(self) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        lot = Lot(opening_transaction=buy)
        mismatched_sell = _sell("t2", "acc1", "aapl", "5", "200", days=1)

        with pytest.raises(LotMismatchError):
            lot.close(mismatched_sell, Decimal("5"))


class TestLotGains:
    def test_realized_gain_is_zero_for_a_fully_open_lot(self) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        lot = Lot(opening_transaction=buy)

        assert lot.realized_gain == Decimal("0")

    def test_realized_gain_reflects_price_difference_on_a_full_close(self) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell = _sell("t2", "acc1", "goog", "10", "150", days=1)
        lot = Lot(opening_transaction=buy)
        lot.close(sell, Decimal("10"))

        assert lot.realized_gain == Decimal("500")  # (150 - 100) * 10

    def test_realized_gain_sums_multiple_partial_closes(self) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell1 = _sell("t2", "acc1", "goog", "4", "150", days=1)
        sell2 = _sell("t3", "acc1", "goog", "6", "80", days=2)
        lot = Lot(opening_transaction=buy)
        lot.close(sell1, Decimal("4"))
        lot.close(sell2, Decimal("6"))

        # (150-100)*4 = 200, (80-100)*6 = -120 -> 80
        assert lot.realized_gain == Decimal("80")

    def test_unrealized_gain_is_zero_for_a_fully_closed_lot(self) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell = _sell("t2", "acc1", "goog", "10", "150", days=1)
        lot = Lot(opening_transaction=buy)
        lot.close(sell, Decimal("10"))

        assert lot.unrealized_gain(Decimal("999")) == Decimal("0")

    def test_unrealized_gain_uses_the_remaining_quantity_at_the_given_price(
        self,
    ) -> None:
        from myapp.domain.position import Lot

        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell = _sell("t2", "acc1", "goog", "4", "150", days=1)
        lot = Lot(opening_transaction=buy)
        lot.close(sell, Decimal("4"))

        assert lot.unrealized_gain(Decimal("120")) == Decimal("120")  # (120-100)*6


class TestComputePosition:
    def test_share_count_and_cost_basis_reflect_only_open_lots(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "10", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "10", "150", days=1)
        sell = _sell("t3", "acc1", "goog", "10", "200", days=2)  # closes buy1 entirely

        position = compute_position("acc1", "goog", [buy1, buy2, sell])

        assert position.share_count == Decimal("10")
        assert position.cost_basis == Decimal(
            "1500"
        )  # 10 remaining shares @ $150 (buy2)

    def test_only_transactions_for_the_requested_account_and_instrument_count(
        self,
    ) -> None:
        relevant = _buy("t1", "acc1", "goog", "10", "100", days=0)
        other_account = _buy("t2", "acc2", "goog", "10", "999", days=0)
        other_instrument = _buy("t3", "acc1", "aapl", "10", "999", days=0)

        position = compute_position(
            "acc1", "goog", [relevant, other_account, other_instrument]
        )

        assert position.share_count == Decimal("10")
        assert position.cost_basis == Decimal("1000")

    def test_empty_transaction_history_gives_a_zero_position(self) -> None:
        position = compute_position("acc1", "goog", [])

        assert position.share_count == Decimal("0")
        assert position.cost_basis == Decimal("0")

    def test_realized_gain_sums_across_all_lots(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "10", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "10", "50", days=1)
        sell1 = _sell("t3", "acc1", "goog", "10", "150", days=2)  # closes buy1
        sell2 = _sell("t4", "acc1", "goog", "5", "40", days=3)  # partially closes buy2

        position = compute_position("acc1", "goog", [buy1, buy2, sell1, sell2])

        # (150-100)*10 = 500, (40-50)*5 = -50 -> 450
        assert position.realized_gain == Decimal("450")

    def test_unrealized_gain_sums_only_open_lots_at_the_given_price(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "10", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "10", "50", days=1)
        sell = _sell("t3", "acc1", "goog", "10", "150", days=2)  # closes buy1 entirely

        position = compute_position("acc1", "goog", [buy1, buy2, sell])

        # only buy2's 10 shares remain open, at a current price of 80
        assert position.unrealized_gain(Decimal("80")) == Decimal("300")

    def test_empty_position_has_zero_gains(self) -> None:
        position = compute_position("acc1", "goog", [])

        assert position.realized_gain == Decimal("0")
        assert position.unrealized_gain(Decimal("100")) == Decimal("0")

    def test_as_of_excludes_transactions_after_that_date(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "10", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "5", "150", days=5)

        position = compute_position(
            "acc1", "goog", [buy1, buy2], as_of=(T0 + timedelta(days=2)).date()
        )

        assert position.share_count == Decimal("10")  # buy2 hasn't happened yet

    def test_as_of_includes_transactions_exactly_on_that_date(self) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)

        position = compute_position("acc1", "goog", [buy], as_of=T0.date())

        assert position.share_count == Decimal("10")

    def test_as_of_none_behaves_like_the_full_ledger(self) -> None:
        buy1 = _buy("t1", "acc1", "goog", "10", "100", days=0)
        buy2 = _buy("t2", "acc1", "goog", "5", "150", days=5)

        position = compute_position("acc1", "goog", [buy1, buy2], as_of=None)

        assert position.share_count == Decimal("15")


class TestRealizedGainEvents:
    def test_returns_one_event_per_close(self) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)
        sell1 = _sell("t2", "acc1", "goog", "4", "150", days=1)
        sell2 = _sell("t3", "acc1", "goog", "6", "80", days=2)

        lots = compute_lots([buy, sell1, sell2])
        events = realized_gain_events(lots)

        assert [(tx.id, gain) for tx, gain in events] == [
            ("t2", Decimal("200")),  # (150-100)*4
            ("t3", Decimal("-120")),  # (80-100)*6
        ]

    def test_open_lots_contribute_no_events(self) -> None:
        buy = _buy("t1", "acc1", "goog", "10", "100", days=0)

        lots = compute_lots([buy])

        assert realized_gain_events(lots) == []
