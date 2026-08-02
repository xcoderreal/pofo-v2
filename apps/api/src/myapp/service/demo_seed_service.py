"""Demo portfolio seeding for a user who has no data of their own.

A fresh user landing on an empty dashboard has nothing to render — no
chart, no holdings, no activity — so every screen would have to be
judged on its empty state. Seeding a realistic portfolio on first login
makes the whole app demonstrable from the first session.

Three constraints shape the fixture below:

1. **Deposits precede the trades they fund.** Every non-CASH trade
   auto-posts a CASH leg (CashService.log_trade), and an overdraw raises
   InsufficientSharesError on that leg. So each account's funding
   deposits must exist *before* its purchases — and because
   TransactionService validates each write against the ledger written so
   far, "before" means write order, not just timestamp order. _EVENTS is
   therefore applied oldest-first and each account's running cash is
   asserted non-negative by a unit test.

2. **No price fetch.** Trade price lives on the Transaction itself, so
   seeding needs no network call (docs/domain-model.md). Market price
   history is fetched lazily the first time a chart asks for it.

3. **Idempotent.** Seeding is keyed on the user having zero Accounts,
   which is sufficient: TransactionService rejects a transaction whose
   account the user doesn't own, so no accounts implies no transactions.

Instrument ids are global (the catalog is not user-scoped), so
instruments are created if-missing and shared. Account and transaction
ids are namespaced per user, since those are global primary keys.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

from myapp.domain.model import (
    Account,
    AccountType,
    AssetClass,
    Instrument,
    Transaction,
    TransactionType,
)
from myapp.service.account_service import AccountService
from myapp.service.cash_service import CashService
from myapp.service.instrument_service import (
    DuplicateIdError,
    DuplicateSymbolError,
    InstrumentService,
)

# (id, symbol, name, asset_class)
_INSTRUMENTS: tuple[tuple[str, str, str, AssetClass], ...] = (
    ("goog", "GOOG", "Alphabet Inc", AssetClass.EQUITY),
    ("aapl", "AAPL", "Apple Inc", AssetClass.EQUITY),
    ("tsla", "TSLA", "Tesla Inc", AssetClass.EQUITY),
    ("voo", "VOO", "Vanguard S&P 500 ETF", AssetClass.ETF),
    ("vti", "VTI", "Vanguard Total Market ETF", AssetClass.ETF),
    ("btc", "BTC-USD", "Bitcoin", AssetClass.CRYPTO),
)

# (slug, name, institution, account_type) — spans all four AccountTypes.
_ACCOUNTS: tuple[tuple[str, str, str, AccountType], ...] = (
    ("brokerage", "Wells Fargo Brokerage", "Wells Fargo", AccountType.BROKERAGE),
    ("ira", "Wells Fargo IRA", "Wells Fargo", AccountType.IRA),
    ("coinbase", "Coinbase", "Coinbase", AccountType.CRYPTO_EXCHANGE),
    ("reserve", "Cash Reserve", "Ally Bank", AccountType.CASH),
)

# (days_ago, account_slug, kind, instrument_id, quantity, unit_price)
# kind: "deposit" | "withdraw" | "buy" | "sell".
# For cash movements instrument_id is None and quantity is the amount.
#
# Shape this fixture is chosen to produce: VOO and GOOG each held in two
# accounts (so the instrument-level "across your accounts" view has more
# than one row), TSLA opened and fully closed (so the closed-positions
# disclosure has content and realized gain is non-zero), and both a
# deposit and a withdrawal on the cash-only account.
_EVENTS: tuple[tuple[int, str, str, str | None, str, str | None], ...] = (
    (730, "reserve", "deposit", None, "48000", None),
    (720, "ira", "deposit", None, "60000", None),
    (715, "ira", "buy", "vti", "90", "220.00"),
    (710, "brokerage", "deposit", None, "60000", None),
    (705, "brokerage", "buy", "voo", "60", "400.00"),
    (700, "ira", "buy", "voo", "30", "405.00"),
    (670, "coinbase", "deposit", None, "25000", None),
    (665, "coinbase", "buy", "btc", "0.6", "31494.34"),
    (650, "brokerage", "buy", "goog", "60", "150.00"),
    (600, "brokerage", "buy", "tsla", "90", "250.00"),
    (400, "ira", "buy", "goog", "120", "151.50"),
    (395, "reserve", "deposit", None, "9000", None),
    (300, "brokerage", "sell", "tsla", "90", "288.00"),
    (200, "brokerage", "buy", "aapl", "40", "175.00"),
    (160, "reserve", "withdraw", None, "4000", None),
    (150, "ira", "buy", "vti", "30", "315.00"),
    (120, "brokerage", "deposit", None, "10000", None),
    (90, "coinbase", "deposit", None, "20000", None),
    (80, "coinbase", "buy", "btc", "0.25", "77910.22"),
    (60, "brokerage", "buy", "goog", "25", "186.00"),
)


@dataclass
class DemoSeedService:
    account_service: AccountService
    instrument_service: InstrumentService
    cash_service: CashService
    # Naive, matching the ledger's existing convention — Transaction
    # timestamps are only ever read via .date() or sorted against each
    # other, and mixing naive with tz-aware would break that sort.
    # Injectable so tests get a fixed "today" (same shape as PriceService).
    clock: Callable[[], datetime] = field(default=lambda: datetime.now())

    def ensure_seeded(self, user_id: str) -> bool:
        """Seed a demo portfolio if this user has none. Returns whether
        anything was written, so a caller can tell "seeded" from
        "already had data" without a second query."""
        if self.account_service.list_accounts(user_id):
            return False

        self._ensure_instruments()
        accounts = self._create_accounts(user_id)
        self._log_events(user_id, accounts)
        return True

    def _ensure_instruments(self) -> None:
        for instrument_id, symbol, name, asset_class in _INSTRUMENTS:
            if self.instrument_service.get_instrument(instrument_id) is not None:
                continue
            try:
                self.instrument_service.create_instrument(
                    Instrument(
                        id=instrument_id,
                        symbol=symbol,
                        name=name,
                        asset_class=asset_class,
                    )
                )
            except (DuplicateIdError, DuplicateSymbolError):
                # Another user's seed created it first — the catalog is
                # global and this is the same outcome either way.
                continue

    def _create_accounts(self, user_id: str) -> dict[str, str]:
        accounts: dict[str, str] = {}
        for slug, name, institution, account_type in _ACCOUNTS:
            account_id = f"demo-{user_id}-{slug}"
            self.account_service.create_account(
                Account(
                    id=account_id,
                    user_id=user_id,
                    name=name,
                    institution=institution,
                    account_type=account_type,
                )
            )
            accounts[slug] = account_id
        return accounts

    def _log_events(self, user_id: str, accounts: dict[str, str]) -> None:
        now = self.clock()
        for index, (days_ago, slug, kind, instrument_id, qty, price) in enumerate(
            _EVENTS
        ):
            timestamp = now - timedelta(days=days_ago)
            transaction_id = f"demo-{user_id}-tx-{index:02d}"
            account_id = accounts[slug]
            quantity = Decimal(qty)

            if kind == "deposit":
                self.cash_service.deposit(
                    id=transaction_id,
                    user_id=user_id,
                    account_id=account_id,
                    amount=quantity,
                    timestamp=timestamp,
                )
            elif kind == "withdraw":
                self.cash_service.withdraw(
                    id=transaction_id,
                    user_id=user_id,
                    account_id=account_id,
                    amount=quantity,
                    timestamp=timestamp,
                )
            else:
                assert instrument_id is not None and price is not None
                self.cash_service.log_trade(
                    Transaction(
                        id=transaction_id,
                        user_id=user_id,
                        account_id=account_id,
                        instrument_id=instrument_id,
                        type=(
                            TransactionType.BUY
                            if kind == "buy"
                            else TransactionType.SELL
                        ),
                        quantity=quantity,
                        price=Decimal(price),
                        timestamp=timestamp,
                    )
                )
