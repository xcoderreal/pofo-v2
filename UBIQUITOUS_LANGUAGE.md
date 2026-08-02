# Ubiquitous Language

Domain glossary for the pofo-v2 portfolio tracker, extracted from the `/grill` design session (2026-08-01). Covers the portfolio domain, the FIFO/gains model ported (with fixes) from the old `pofo` repo, the generic analytics query interface, and the auth/persistence environment model.

## Portfolio structure

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Account** | A brokerage/IRA/cash/crypto-exchange holding vehicle the user owns (e.g. "Wells Fargo Brokerage"). A required, first-class breakdown dimension. | Portfolio (see below), Wallet |
| **Instrument** | A tradeable thing identified by symbol — equity, ETF, or crypto. **Cash is also an Instrument** (`asset_class = cash`, e.g. symbol `USD`), not a separate concept. | Security, Ticker, Asset (ambiguous — see Asset Class) |
| **Asset Class** | The closed-enum category an Instrument belongs to: `equity`, `etf`, `crypto`, `cash`. Drives which price-staleness rule applies (market-hours-aware vs. always-eligible). | Instrument Type |
| **Transaction** | A single ledger entry, always instrument-scoped: `type ∈ {BUY, SELL}`, `account_id`, `instrument_id`, `quantity`, `price`, `timestamp`. One shape, no exceptions — a cash deposit is a `BUY` of the `CASH` Instrument at `price = 1`; a withdrawal is a `SELL` of it. The only durably *stored* fact — everything else below is computed from it. | Trade (too narrow — excludes deposit/withdrawal), Activity |
| **Deposit** / **Withdrawal** | Entrypoints-layer labels (request shape / UI action), not a domain type — a Deposit *is* a `BUY` **Transaction** of the `CASH` **Instrument**; a Withdrawal *is* a `SELL`. Exists so the API and UI read naturally without adding a second **Transaction** shape. | A distinct domain-level transaction type (rejected — collapsed to keep one Transaction shape) |
| **Lot** | A single opening `BUY` (or `SELL`, for a short) and the portion of it still unmatched by a closing transaction. The atomic unit FIFO operates on. | Tax Lot (fine as a synonym in tax-specific contexts, but **Lot** is canonical elsewhere) |
| **Position** | The aggregated, *computed* (never stored) net view of all open Lots for one Instrument within one Account — share count, cost basis, current equity. | Holding |
| **Corporate Action** | Splits, dividends, mergers, spinoffs — events that retroactively reinterpret past Transactions. **Explicit v1 non-goal**; flagged here so the term exists before the feature does. | — |

## Money and gains (computed, never stored)

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Cash Balance** | A Position of the `CASH` Instrument — reuses the exact same computation as any other Position. Derived by folding every `BUY`/`SELL` Transaction of `CASH` (i.e. every Deposit/Withdrawal) plus the implicit cash leg of every non-cash `BUY`/`SELL`. Since `cost_per_unit = 1` for `CASH`, `cost_basis == share_count` and `realized_gain` on it is always `0` — falls out of the same math, not a special case. | Cash Position (fine as synonym), Balance (too vague alone) |
| **Cost Basis** | The total original cost of a Position's still-open Lots (FIFO-derived fold over Transactions). | Basis |
| **Equity** | The current market value of a Position: `share_count × market_price`. A **composite** metric (see Query Interface below). | Market Value (fine as synonym), Value (too vague alone) |
| **Realized Gain** | Profit/loss locked in when a Lot is closed by an opposite-sign Transaction. A **flow** — only meaningful over an interval, never at a single instant. | — |
| **Unrealized Gain** | `Equity − Cost Basis` for a still-open Position. A **level** — meaningful at a single instant, not as a cumulative/period total. | — |
| **Lot Matching Strategy** | The ordering rule for which Lot a closing Transaction consumes first: FIFO (default/only one built for v1), LIFO, Highest-Cost. **Scoped strictly per-Account** — a Lot can only be closed by a Transaction in the same Account (matches real custodial/tax reality). | *(old `pofo` had two colliding types both named `PositionMatchingStrategy` — one live enum, one dead ABC hierarchy. Neither name survives; this is the one canonical term.)* |

## Query interface

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Metric** | One named, closed-enum computed series: `equity`, `share_count`, `cost_basis`, `cash_balance`, `unrealized_gain`, `realized_gain`, `market_price`. Never an open-ended formula language. | — |
| **Primitive Metric** | A Metric computed by exactly one deterministic path: either a raw pass-through of stored data (`market_price`), or a single fold over the Transaction ledger (`share_count`, `cost_basis`, `realized_gain`). | — |
| **Composite Metric** | A Metric computed as pure pointwise arithmetic over exactly two Primitive Metrics (`equity = share_count × market_price`; `unrealized_gain = equity − cost_basis`). Never a third tier — composites don't compose further. | — |
| **Level** | A Metric kind that's meaningful at a single instant (`equity`, `share_count`, `cost_basis`, `cash_balance`, `unrealized_gain`). Valid **Mode**: `point_in_time` only. | Stock (economics term, avoid — confusable with "stock" the instrument) |
| **Flow** | A Metric kind meaningful only over an interval, never at an instant (`realized_gain`). Valid **Mode**: `cumulative` or `delta_per_period` only. | — |
| **Mode** | How a Metric's series is sampled/aggregated: `point_in_time`, `cumulative`, `delta_per_period`. Validity is constrained by the Metric's Level/Flow kind — not every (Metric, Mode) pair is legal (see table below). | — |
| **Group By** | Whether a query returns one combined series (`none`) or one series per Account/Instrument (`account`/`instrument`) for the matched scope. | Breakdown (fine as informal synonym) |

**Valid (Metric, Mode) pairs — every Level Metric is `point_in_time`-only; the sole Flow Metric is `cumulative`/`delta_per_period`-only. A "change over a period" question for a Level Metric is answered by differencing two `point_in_time` samples client-side, not by a new mode.**

| Metric | Kind | `point_in_time` | `cumulative` | `delta_per_period` |
|---|---|:---:|:---:|:---:|
| `equity` | Level | ✅ | ❌ | ❌ |
| `share_count` | Level | ✅ | ❌ | ❌ |
| `cost_basis` | Level | ✅ | ❌ | ❌ |
| `cash_balance` | Level | ✅ | ❌ | ❌ |
| `unrealized_gain` | Level | ✅ | ❌ | ❌ |
| `market_price` | Level | ✅ | ❌ | ❌ |
| `realized_gain` | Flow | ❌ | ✅ | ✅ |

## Auth and environments

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Stub Auth** | `MYAPP_AUTH=stub` — every request resolves to one fixed, hardcoded Dev User; no real login, no JWT. Hard-guarded out of production by config validation. | — |
| **Dev User** | The fixed synthetic identity Stub Auth always returns. Re-provisioned automatically (not by hand) whenever the dev Supabase stack is reset, alongside a real seeded login for exercising Supabase Auth mode. | — |
| **RLS (Row Level Security)** | Postgres policies scoping every row to its owning `user_id`, enforced at the database layer. Real in every environment from the first migration; only *exercised* (not bypassed by the service-role key) when Supabase Auth mode is active. | — |
| **Price Sync** | The lazy, on-demand, incremental fetch of missing/stale market-price history for one Instrument, gap-filled from the last stored bar. Explicitly **not** a scheduled job in v1 (cron is a deferred, additive extension of the same fetch logic). | Price Fetch (fine as informal synonym) |

## Relationships

- An **Account** holds zero or more open **Lots**, each for exactly one **Instrument**.
- A **Position** is the aggregation of an Account's open **Lots** for one **Instrument** — it is never stored, only computed from **Transactions**.
- A **Lot** can only be closed by a **Transaction** in the *same* **Account** (per-Account FIFO scoping).
- **Cash Balance** is a **Position** like any other — the **CASH** **Instrument** is not a special case in the computation, only in what it represents.
- A **Composite Metric** is defined in terms of exactly two **Primitive Metrics**; a **Primitive Metric** is defined in terms of the **Transaction** ledger or raw price data — never the reverse.

## Example dialogue

> **Dev:** "For 'GOOG equity in Wells Fargo Brokerage, monthly, last 24 months' — is that a **Position** query or a **Metric** query?"
>
> **Domain expert:** "**Metric** query — `metric=equity, instruments=[GOOG], accounts=[wf-brokerage], granularity=monthly, mode=point_in_time`. **Equity** is a **Composite Metric**, so under the hood it's still resolving a **Position** at each sampled point — but the caller never asks for 'a Position,' only for a Metric series."
>
> **Dev:** "Could I ask for `metric=realized_gain, mode=point_in_time`?"
>
> **Domain expert:** "No — **Realized Gain** is a **Flow**, not a **Level**. `point_in_time` isn't valid for it; you'd use `cumulative` or `delta_per_period`."
>
> **Dev:** "If I sell GOOG in the IRA, can that close a Lot that was opened in the Brokerage account?"
>
> **Domain expert:** "Never — **Lot Matching Strategy** is scoped strictly per-**Account**. That's not an optimization, it's a tax-accuracy requirement."

## Flagged ambiguities

- **"Account"** is used only for the portfolio domain concept (brokerage/IRA/etc.) in this codebase — never for the auth identity, which is **User**/**Dev User**. Keep these visually and terminologically distinct everywhere, since old `pofo` never had this collision but the *auth* work now underway is a natural place for it to creep in.
- **"Position" vs. "Lot"** — a **Position** is the aggregate (what a screen shows: "10 shares of GOOG"); a **Lot** is one FIFO-tracked chunk of it (what the tax math operates on). Never use them interchangeably in code, tests, or docs.
- **"Cash"** is overloaded in casual speech (money in general) but has exactly one canonical meaning here: `asset_class = cash` on an **Instrument**. "Cash Balance" is the computed **Position** of that Instrument — always say which one is meant.
- **`PositionMatchingStrategy`** (old `pofo`'s naming) is retired entirely — it existed as two colliding, differently-shaped types (a live enum and a dead ABC hierarchy) in the source repo. The canonical term going forward is **Lot Matching Strategy**, one implementation, no synonym.
- **"Sync"** on its own is ambiguous between the deferred cron-based idea and the v1 lazy on-demand behavior — always say **Price Sync** and, where it matters, whether it's the lazy path (v1) or the future scheduled path.
