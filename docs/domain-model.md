# Domain Model

The portfolio-tracker domain, replacing the skeleton's `Item`/`Category` scaffolding. Read [`UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md) alongside this — that file defines terms precisely; this file explains the reasoning and the shapes.

This doc describes the **target design**, not yet-built code. Follow `CLAUDE.md`'s "Adding a new resource" ordering when implementing: `domain/model.py` → `domain/repository.py` → `adapters/` → `service/` → tests → `entrypoints/api.py` → tests.

## Entities (`domain/model.py`)

```python
@dataclass
class Account:
    id: str
    user_id: str
    name: str                  # e.g. "Wells Fargo Brokerage"
    institution: str
    account_type: AccountType  # brokerage | ira | crypto_exchange | ...


@dataclass
class Instrument:
    id: str
    symbol: str                 # e.g. "GOOG", "SOXL", "BTC", "USD" (for CASH)
    name: str
    asset_class: AssetClass     # equity | etf | crypto | cash


@dataclass
class Transaction:
    id: str
    user_id: str
    account_id: str
    instrument_id: str          # ALWAYS set — even for deposits/withdrawals (see below)
    type: TransactionType       # BUY | SELL
    quantity: Decimal
    price: Decimal               # per-unit price; always 1 for CASH
    timestamp: datetime
```

**Why `Transaction` has exactly one shape.** A deposit is a `BUY` of the `CASH` `Instrument` (`price = 1`); a withdrawal is a `SELL` of it. There is no second, instrument-less transaction shape — that was considered and rejected during design (see `UBIQUITOUS_LANGUAGE.md`'s "Deposit"/"Withdrawal" entry). `Deposit`/`Withdrawal` exist only as **entrypoints-layer** request labels (`POST /transactions/deposit` reads better than asking a user to pick an instrument called "USD"), translated to a `BUY`/`SELL` of `CASH` before reaching the service layer. This is why cash falls out of the *same* Position computation as every other instrument instead of needing a parallel cash-ledger implementation.

**Why no `Position` or `Lot` dataclass is persisted.** Both are *computed* from `Transaction` history — see "Computed, not stored" below. Storing them would create a second source of truth that can drift from the ledger; the ledger is the only durable fact.

## Computed, not stored: Lot, Position, gains

`Lot` and `Position` are pure functions over a list of `Transaction`s — no repository, no persistence. This mirrors the skeleton's "computed vs. stored" principle already validated in earlier experiment runs on this skeleton.

```
compute_lots(transactions: list[Transaction]) -> list[Lot]
compute_position(account_id, instrument_id, transactions, as_of=None) -> Position
```

### FIFO lot matching — ported from `pofo`, with two fixes

The reference implementation lives in the (untouched, read-only) `pofo` repo at `domain/models/__init__.py` (`PositionLot`, `MatchingContext`, `Position`) and `services/capital_gains_service.py`/`services/position_service.py`. **Do not port anything from `services/position_computation_service.py`, `models/computed_position.py`, `models/capital_gains.py`, `models/instrument.py`, or `domain/services/position_matching_service.py`** — an audit during design found these form a dead, partially-broken parallel implementation (see the design session's findings; not reproduced here since none of it should be read as reference).

Two invariants the ported logic must gain that the source lacked:

1. **Per-Account scoping is a real domain invariant, not caller discipline.** In `pofo`, `PositionLot.can_close_with()` only checks opposite transaction sign — it has no idea about `account_id`/`instrument_id`, and is only correct today because every call site happens to pre-filter. In this rewrite, the lot-closing function must assert `lot.account_id == transaction.account_id and lot.instrument_id == transaction.instrument_id` explicitly and raise on mismatch, so a future caller (including the generic query interface below, or a future reasoner/MCP caller) can't silently cross-match lots across accounts.
2. **One implementation, one name.** `pofo` had two colliding types both named `PositionMatchingStrategy` (a live enum, a dead ABC hierarchy). This rewrite has exactly one: `LotMatchingStrategy` (enum: `FIFO`, with `LIFO`/`HIGHEST_COST` values reserved but unused — FIFO is the only implemented behavior for v1).

**Why FIFO scoped per Account.** Brokerage accounts are separate custodial pools — you cannot literally sell a share from an account that never held it — and IRS cost-basis/wash-sale computation is per-account in reality. A "whole portfolio" view is a pure sum of independently-computed per-account series, never a cross-account lot merge.

### Gains

- **Cost Basis** — sum of `quantity_remaining × cost_per_unit` over an Instrument+Account's open Lots.
- **Realized Gain** — locked in when a Lot is closed; a `Flow` (see Query Interface below), computed per closing event, never as a running stored balance.
- **Unrealized Gain** — `Equity − Cost Basis` for open Lots, using the latest `market_price`. A `Level`.

## Price data (`adapters/`)

A `PriceSource` ABC (capability-named, not vendor-named) behind `domain/`, concrete `YFinancePriceSource` in `adapters/`. Single provider — yfinance covers both equities and crypto (e.g. `BTC-USD`), so no second provider is needed for v1.

- **Lazy, on-demand, incremental.** A price fetch happens only when a request needs `market_price` data not already covered by stored history — and then only for the missing gap, appended to storage. No cron/scheduled sync in v1 (see `docs/non-goals.md`).
- **Staleness TTL branches on `asset_class`.** Equity/ETF: skip refetch outside a simple US/Eastern weekday 9:30–16:00 check (false positives on holidays are acceptable — deliberately not a full trading-calendar dependency). Crypto: fixed short TTL (e.g. 15 min), since it trades continuously.
- **Trade price lives on the `Transaction` itself**, independent of `market_price` history — so seeding/backfilling transactions never requires a live price fetch. The first time a chart for a symbol is opened (in *any* environment, dev or prod) is the first time that symbol's `market_price` history is ever fetched.

## Query interface (`service/`)

One generic time-series query, not one endpoint per question shape — designed to answer arbitrary (symbol × account × time × granularity) breakdowns without hook/endpoint multiplication, and to be a small, well-defined surface for a future conversational/reasoner layer (see `docs/non-goals.md`).

```python
def query_timeseries(
    user_id: str,
    metric: Metric,               # equity | share_count | cost_basis | cash_balance
                                    # | unrealized_gain | realized_gain | market_price
    instruments: list[str] | Literal["all"],
    accounts: list[str] | Literal["all"],
    group_by: Literal["none", "instrument", "account"],
    start: date,
    end: date,
    granularity: Literal["daily", "weekly", "monthly", "yearly"],
    mode: Mode,                    # point_in_time | cumulative | delta_per_period
) -> list[Series]:                 # one Series per group; sparse, real-timestamped points
    ...
```

### Metrics: primitive vs. composite

Kept as a **closed, finite enum** — never an open-ended formula/expression language. Every metric is either:

- **Primitive** — computed by exactly one deterministic path: a raw pass-through of stored data (`market_price`), or a single fold over the `Transaction` ledger (`share_count`, `cost_basis`, `realized_gain`).
- **Composite** — pure pointwise arithmetic over *exactly two* primitives, no further nesting: `equity = share_count × market_price`; `unrealized_gain = equity − cost_basis`.

### (Metric, Mode) validity

Every metric is a `Level` (meaningful at an instant) or a `Flow` (meaningful only over an interval) — this is the accounting stock/flow distinction, and it fully determines which `Mode`s are legal:

| Metric | Kind | `point_in_time` | `cumulative` | `delta_per_period` |
|---|---|:---:|:---:|:---:|
| `equity` | Level | ✅ | ❌ | ❌ |
| `share_count` | Level | ✅ | ❌ | ❌ |
| `cost_basis` | Level | ✅ | ❌ | ❌ |
| `cash_balance` | Level | ✅ | ❌ | ❌ |
| `unrealized_gain` | Level | ✅ | ❌ | ❌ |
| `market_price` | Level | ✅ | ❌ | ❌ |
| `realized_gain` | Flow | ❌ | ✅ | ✅ |

The service validates `(metric, mode)` against this table and rejects invalid pairs (400), rather than silently computing something meaningless. "How much did equity change this month" is answered by two `point_in_time` samples differenced client-side — not a new mode.

`accounts` is meaningless for `market_price` (no account dimension); the service rejects that combination explicitly rather than silently ignoring it.

### Result shape

Sparse, real-timestamped points — **not** a dense/gap-filled array. The frontend chart derives x-position from real timestamps (nearest-point lookup from pointer/tap position), not array index, so there's no requirement to pad non-trading days with carried-forward values.

## Non-goals for this doc

See [`docs/non-goals.md`](non-goals.md) for the full list with reasoning: corporate actions (splits/dividends/mergers), CSV import, multiple price providers, cron-based price sync, LIFO/highest-cost lot matching, and the conversational/reasoner interface.
