from datetime import date

import pytest

from myapp.domain.model import (
    Account,
    AccountType,
    Instrument,
    Transaction,
    TransactionType,
)
from myapp.service.portfolio_service import PortfolioService
from tests.fake_price_source import FakePriceSource
from tests.fake_repository import (
    FakeAccountRepository,
    FakeInstrumentRepository,
    FakeTransactionRepository,
)


@pytest.fixture
def price_source():
    return FakePriceSource({"AAPL": 150.0, "GOOGL": 2800.0})


@pytest.fixture
def account_repo():
    return FakeAccountRepository(
        [
            Account(
                id="schwab", name="Schwab Brokerage", account_type=AccountType.BROKERAGE
            ),
            Account(
                id="fidelity", name="Fidelity IRA", account_type=AccountType.BROKERAGE
            ),
        ]
    )


@pytest.fixture
def instrument_repo():
    return FakeInstrumentRepository(
        [
            Instrument(id="aapl", ticker="AAPL", name="Apple Inc."),
            Instrument(id="googl", ticker="GOOGL", name="Alphabet Inc."),
        ]
    )


@pytest.fixture
def transaction_repo():
    return FakeTransactionRepository(
        [
            Transaction(
                "t1",
                "schwab",
                "aapl",
                TransactionType.BUY,
                10,
                100.0,
                date(2024, 1, 15),
            ),
            Transaction(
                "t2",
                "schwab",
                "googl",
                TransactionType.BUY,
                5,
                2500.0,
                date(2024, 2, 1),
            ),
            Transaction(
                "t3",
                "fidelity",
                "aapl",
                TransactionType.BUY,
                20,
                110.0,
                date(2024, 3, 1),
            ),
        ]
    )


@pytest.fixture
def service(account_repo, instrument_repo, transaction_repo, price_source):
    return PortfolioService(
        account_repo=account_repo,
        instrument_repo=instrument_repo,
        transaction_repo=transaction_repo,
        price_source=price_source,
    )


# ─── Account CRUD ────────────────────────────────────────────


def test_list_accounts(service):
    assert len(service.list_accounts()) == 2


def test_create_account(service):
    acct = Account(
        id="vanguard", name="Vanguard 401k", account_type=AccountType.BROKERAGE
    )
    service.create_account(acct)
    assert len(service.list_accounts()) == 3
    assert service.get_account("vanguard").name == "Vanguard 401k"


def test_delete_account(service):
    assert service.delete_account("schwab") is True
    assert len(service.list_accounts()) == 1


# ──�� Instrument CRUD ────────────��────────────────────────────


def test_list_instruments(service):
    assert len(service.list_instruments()) == 2


def test_create_instrument(service):
    inst = Instrument(id="msft", ticker="MSFT", name="Microsoft Corp.")
    service.create_instrument(inst)
    assert len(service.list_instruments()) == 3


# ─── Transaction CRUD ──────────────��─────────────────────────


def test_list_transactions(service):
    assert len(service.list_transactions()) == 3


def test_list_transactions_by_account(service):
    txns = service.list_transactions(account_id="schwab")
    assert len(txns) == 2
    assert all(t.account_id == "schwab" for t in txns)


def test_list_transactions_by_instrument(service):
    txns = service.list_transactions(instrument_id="aapl")
    assert len(txns) == 2
    assert all(t.instrument_id == "aapl" for t in txns)


def test_create_transaction_buy(service):
    txn = Transaction(
        "t4", "schwab", "aapl", TransactionType.BUY, 5, 140.0, date(2024, 4, 1)
    )
    service.create_transaction(txn)
    assert len(service.list_transactions()) == 4


def test_sell_validation_rejects_oversell(service):
    sell = Transaction(
        "s1", "schwab", "aapl", TransactionType.SELL, 50, 150.0, date(2024, 6, 1)
    )
    with pytest.raises(ValueError, match="Cannot sell"):
        service.create_transaction(sell)


def test_sell_validation_allows_valid_sell(service):
    sell = Transaction(
        "s1", "schwab", "aapl", TransactionType.SELL, 5, 150.0, date(2024, 6, 1)
    )
    service.create_transaction(sell)
    assert len(service.list_transactions()) == 4


# ─── Positions ────────────────────────────────────────────────


def test_positions_by_instrument(service):
    positions = service.get_positions()
    assert len(positions) == 2  # AAPL and GOOGL
    aapl = next(p for p in positions if p.instrument_id == "aapl")
    assert aapl.quantity == 30  # 10 + 20 across accounts
    assert aapl.current_price == 150.0
    assert aapl.market_value == pytest.approx(4500.0)


def test_positions_by_account(service):
    positions = service.get_positions(account_id="schwab")
    assert len(positions) == 2  # AAPL and GOOGL in Schwab
    aapl = next(p for p in positions if p.instrument_id == "aapl")
    assert aapl.quantity == 10
    assert aapl.account_id == "schwab"


def test_positions_by_account_and_instrument(service):
    positions = service.get_positions(account_id="fidelity", instrument_id="aapl")
    assert len(positions) == 1
    assert positions[0].quantity == 20
    assert positions[0].cost_basis == pytest.approx(2200.0)


# ─── Capital gains ────────────────────────────────────────────


def test_realized_gains_with_sells(service):
    sell = Transaction(
        "s1", "schwab", "aapl", TransactionType.SELL, 5, 150.0, date(2024, 6, 1)
    )
    service.create_transaction(sell)
    gains = service.get_realized_gains(account_id="schwab", instrument_id="aapl")
    assert len(gains) == 1
    assert gains[0].gain == pytest.approx(250.0)  # (150-100)*5


def test_no_realized_gains_without_sells(service):
    gains = service.get_realized_gains()
    assert gains == []


# ─── Portfolio history ���───────────────────────────────────────


def test_portfolio_history(service):
    history = service.get_portfolio_history()
    assert len(history) >= 1
    # Each entry has date, market_value, cost_basis
    for entry in history:
        assert entry.date is not None
        assert entry.cost_basis >= 0


def test_portfolio_history_by_account(service):
    history = service.get_portfolio_history(account_id="schwab")
    assert len(history) >= 1
