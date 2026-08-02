# Project Context And Language

This is the fork's durable glossary and product context. Update it when domain
terms, user roles, workflow names, or naming ambiguities become important enough
that future agents should not invent near-synonyms.

Keep this file short. It is not a spec, backlog, or changelog. The full domain
glossary with definitions, aliases-to-avoid, relationships, and an example
dialogue lives in [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) — this file
is the compact index. Implementation rules belong to
[`docs/domain-model.md`](docs/domain-model.md), [`docs/architecture.md`](docs/architecture.md),
[`docs/auth.md`](docs/auth.md), and [`docs/testing.md`](docs/testing.md).

## Product Context

- **Product name:** pofo-v2 (working name — a personal portfolio tracker)
- **Primary user:** a single owner (the repo's maintainer), tracking their own real brokerage/crypto holdings. Not multi-tenant SaaS; real auth exists because this is real financial data on a public deployment, not because there are multiple users.
- **Core job:** answer "how is my portfolio doing" at any slice — one symbol, one account, everything — over any time range and granularity, without hand-maintained spreadsheets.
- **Source of truth:** the `Transaction` ledger (user-entered) plus externally-sourced `market_price` history (yfinance, lazily fetched). Every other number (positions, gains, equity) is computed from these on read, never stored.

## Domain Vocabulary

See [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) for full definitions. Quick index of the load-bearing terms:

| Term | One-line meaning |
|---|---|
| **Account** | A brokerage/IRA/cash/crypto-exchange holding vehicle. Required breakdown dimension. |
| **Instrument** | A tradeable thing (equity/etf/crypto), or cash itself (`asset_class = cash`). |
| **Transaction** | The one stored fact: `BUY`/`SELL` of an Instrument in an Account. Deposits/withdrawals are `BUY`/`SELL` of `CASH`. |
| **Lot** | One FIFO-tracked chunk of an opening Transaction. Closes only against Transactions in the *same* Account. |
| **Position** | Computed aggregate of open Lots for one Instrument in one Account. Never stored. |
| **Metric** | One of a closed set of computed series (`equity`, `share_count`, `realized_gain`, ...) exposed by the query interface. |
| **Corporate Action** | Splits/dividends/mergers. Explicit v1 non-goal — see [`docs/non-goals.md`](docs/non-goals.md). |

## Workflow Vocabulary

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Feature Goal** | A checked-in brief for multi-step work under `docs/notes/feature-goals/` (created as needed, not pre-populated). | Spec, TODO, plan when ambiguous |
| **Evidence** | Observable proof: test output, HTTP response, browser trace, screenshot, deployed smoke, or persisted state. | Reasoning, confidence |
| **Gap** | Known missing, deferred, or unverified behavior recorded at the narrowest durable home. | Vague TODO |

## Relationships

- An **Account** holds zero or more open **Lots**, each for exactly one **Instrument**.
- A **Position** is computed from an Account's open **Lots** for one **Instrument** — never stored.
- A **Lot** closes only against a **Transaction** in the same **Account** (per-Account FIFO — see `docs/domain-model.md`).
- A **User** (auth identity, Supabase-issued) owns **Account**s via `user_id` + RLS. **User** is never conflated with **Account** — see Flagged Ambiguities in `UBIQUITOUS_LANGUAGE.md`.

## Flagged Ambiguities

See `UBIQUITOUS_LANGUAGE.md`'s "Flagged ambiguities" section (Account vs. User, Position vs. Lot, Cash's overload, the retired `PositionMatchingStrategy` naming from the reference `pofo` repo).

## Updating This File

Update this file when a term appears in code, docs, tests, and conversation often
enough that drift would be costly. Do not add every UI label. Prefer terms that
shape domain models, API contracts, service methods, test names, or feature
briefs. When adding/changing a term here, also update `UBIQUITOUS_LANGUAGE.md`'s
full entry — this file is an index into that one, not a fork of it.
