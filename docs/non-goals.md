# Non-goals (v1)

Explicit parking lot from the design session. Each entry exists so a future session doesn't rediscover the same tradeoff from scratch, and so "not built yet" reads as a decision, not an oversight. Revisit any of these when there's a concrete, real need — not speculatively.

## Corporate actions (splits, dividends, mergers, spinoffs)

**Why deferred:** these retroactively reinterpret past `Transaction`s (a split changes share count *and* cost-per-share for every historical Lot of an instrument) — the nastiest category of domain complexity here, and one with no good general answer worked out during design. **How to handle if one happens before this is built:** model it as a manual, one-off adjustment (a correcting `Transaction` or a direct price/quantity fix), not general machinery. Revisit if a real holding actually splits/pays a dividend before this is designed properly.

## CSV import

**Why deferred:** every brokerage/exchange (Fidelity, Coinbase, Wells Fargo, ...) exports a materially different CSV shape — different columns, different representations of buy vs. sell. A generic user-facing column-mapping importer is real UI complexity for a hypothetical second/third format that may never be needed. **v1 approach:** manual single-transaction entry form; seeded/synthetic data for development. **Path to import later:** bespoke, one-off parser scripts per real source format, built only once a real export file is in hand — not a generic importer.

## Multiple price providers

**Why deferred:** yfinance covers both equities and crypto (e.g. `BTC-USD`) under one namespace — a second provider (e.g. CoinGecko) would add dependency surface without a concrete gap it closes. Revisit only if yfinance proves unreliable for a specific asset class actually held.

## Cron-based / scheduled price sync

**Why deferred:** v1 is lazy/on-demand only (`docs/domain-model.md`), which is inherently "respectful" of upstream rate limits — no view, no call. A scheduled backfill (Vercel Cron hitting a sync endpoint) is an **additive** extension of the same fetch logic, not a redesign — build it when there's a real need (e.g. wanting charts to be pre-warmed rather than fetched on first view), not preemptively.

## LIFO / highest-cost lot matching

**Why deferred:** `LotMatchingStrategy` is designed as an enum with FIFO as the only implemented value, `LIFO`/`HIGHEST_COST` reserved but unbuilt. Only FIFO was validated as necessary; adding the others is additive when there's a real tax-optimization need.

## Inter-account transfers

**Why deferred:** moving Lots between Accounts (not a buy or sell) wasn't part of any concrete query asked for during design. Falls out of scope alongside corporate actions as "ledger-mutating" complexity without a validated need yet.

## Conversational / reasoner interface

**Why deferred:** the query interface (`docs/domain-model.md`) was *deliberately* shaped — closed metric enum, primitive/composite split, explicit (metric, mode) validity — specifically to make a future NL-query layer a small, low-risk follow-up (map NL → the six query params) rather than a redesign. An earlier attempt at this (a "mildly janky" MCP integration against the old `pofo` repo, which called bespoke per-question service methods rather than one generic query shape) is believed to be why it didn't work well. Build the core CRUD + dashboard + charts first, on a solid query interface; the conversational layer is cheap once that foundation exists.

## Multi-user / shared portfolios

**Why deferred:** single-user app (`CONTEXT.md`). Real auth exists because this is real financial data on a public URL, not because there's more than one user. `user_id` + RLS are modeled from day one specifically so this *would* be a small extension later, not a redesign — but sharing/multi-tenant UX itself is unbuilt.
