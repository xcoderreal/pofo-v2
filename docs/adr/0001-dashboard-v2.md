# ADR-0001 — Dashboard v2: cash, scope and the query surface

**Status:** accepted
**Date:** 2026-08-02
**Supersedes:** parts of `docs/domain-model.md` § Query interface (noted inline below)

Resolved in a design interview against the
[dashboard v2 prototype](../design/dashboard_v2/). Eighteen decisions;
the eight with lasting architectural weight are recorded here. The rest —
range vocabulary, control-row layout, matrix scrolling — are behavioural
and live in [`behaviour.md`](../design/dashboard_v2/behaviour.md).

Each entry records the **rejected** alternatives, because several of
these look arbitrary from the code alone and are the kind of thing a
future change would "simplify" away.

---

## 1. A trade auto-posts a cash leg

**Decision.** Buying GOOG writes the GOOG BUY *and* a CASH SELL of equal
value in the same Account, atomically. Selling writes the inverse.
Deposits and Withdrawals stay unpaired.

**Why it was forced, not chosen.** The Grid tab shows "total portfolio
value" as `equity + cash`. Without a cash side, depositing $48,000 and
buying $25,005 of VOO yields `48,000 + 25,005 = $73,005` — the same
dollars counted twice. There is no third option that keeps both the tile
and an untouched cash ledger.

**Rejected:** leaving cash independent (what shipped through #12) — makes
`cash_balance` mean "deposits I happened to record", not "uninvested
cash", and breaks the moment an account both receives a deposit and
trades. **Rejected:** letting the user opt out per transaction — an
option that produces a knowingly-wrong total is not worth its switch.

## 2. The pair is correlated by a stored `trade_id`, not derived

**Decision.** Both legs carry the same `trade_id` — the primary leg's own
id. One genuinely new stored fact.

**Why.** It keeps *one* derivation path for every instrument including
CASH: `Position(CASH)`, `cash_balance` and the CASH invariants all come
from the same `compute_lots`/`compute_position` calls as any equity. The
insufficient-cash check is then not new logic at all — it is
`Lot.close()`'s existing FIFO overdraw check firing on the CASH leg.

**Rejected:** deriving the cash side on read (fold the ledger: deposits −
withdrawals − purchases + proceeds) instead of storing rows. Tempting —
no correlation field, one row per trade, trivially consistent
edit/delete. But it gives `cash_balance` its own bespoke fold and breaks
the uniformity above. One stored field bought zero new derivation, which
is the better trade.

**Rejected:** matching legs implicitly on account + timestamp + amount.
Collides on same-day trades of equal value, which is exactly what
recurring buys look like.

**Consequence:** Activity must hide CASH rows carrying a `trade_id` (see
[`behaviour.md`](../design/dashboard_v2/behaviour.md) § Activity).

## 3. `equity` excludes CASH at `"all"` scope

**Decision.** `_resolve_instruments("all")` omits the CASH instrument for
`equity`, `cost_basis` and `unrealized_gain`. An explicit
`instruments=["cash"]` is still honoured.

**Why.** With decision 1 in place, `equity` and `cash_balance` become
non-overlapping, so `equity + cash_balance` is a correct total and the
prototype's main screen figure (holdings only) matches its Grid tile
(holdings + cash). Without the exclusion, a whole-portfolio equity chart
silently adds your cash balance to your holdings.

**Rejected:** including CASH and dropping the separate cash concept —
one number, no exclusion rule, but the Holdings list then has to
special-case a `USD` row and the headline figure stops matching the
design.

**Amends** `docs/domain-model.md` § Query interface, which describes
`instruments: "all"` without this carve-out.

## 4. Insufficient cash raises

**Decision.** A trade that would overdraw its Account's cash is rejected,
via the existing `InsufficientSharesError` on the CASH leg.

**Rejected:** exempting CASH from lot matching so balances may go
negative. Defensible — FIFO over CASH is provably a no-op since every
lot prices at 1, so realized gain is always zero and ordering is
irrelevant — and it would make manual back-entry order-independent. Not
taken: an always-defensible balance was preferred.

**Consequence, and it is not small.** Entry is now order-dependent.
Funding Deposits must be recorded before the trades they pay for, and
since inter-account transfers are out of scope, each trading Account
needs its own Deposits. This is why the demo seed asserts a
never-negative running cash balance (#13) and why the buy form must show
cash available (#22).

## 5. A batched positions endpoint, not more time-series calls

**Decision.** Add an endpoint returning computed `Position` rows keyed by
`(account_id, instrument_id)` across a scope. Lists, the instrument stat
card and the Grid matrix each read it once. `query_timeseries` keeps
charts and sparklines.

**Why.** Most of the dashboard is current state, not a series. Served
purely through `query_timeseries` with `start = end = today`, one screen
costs ~5 round trips and the Grid ~8–11 — and the matrix is not
expressible at all, being two-dimensional while `GroupBy` is
single-valued. A holdings row *is* a `Position`; reassembling one from
three single-point series queries works against both shapes.

It is not a new architectural direction: the single-pair position
endpoint already exists from #8, and this is that shape batched.

**Rejected:** widening `GroupBy` to accept a list (`[instrument,
account]`) purely to serve a non-chart matrix. Position rows pivot into
the matrix client-side, so the query interface never grows a 2D case.

## 6. Metric/scope conflicts auto-resolve in the UI

**Decision.** One rule, two halves:

- Metric **needs** a dimension you lack (`share_count`, `market_price`
  with no instrument) → **disabled**, with the reason shown.
- Metric **lacks** a dimension you have (`market_price` + account,
  `cash_balance` + instrument) → **auto-clear that chip**, with Undo.

**Why.** The API rejects both mismatches with a 400 — deliberately,
"rather than silently ignoring it". The prototype computes locally and
ignores them, so two ordinary UI states would have produced errors. The
app already auto-adjusts metric-for-scope in two places; this is the
symmetric direction.

**Rejected:** relaxing the API to ignore irrelevant dimensions — reopens
a decision made explicitly in the original spec. **Rejected:** disabling
in both directions — reaching Market price from a slice would need a
manual back-out first.

## 7. Edit and delete are guarded by a ledger replay

**Decision.** Apply the mutation to a candidate ledger, recompute that
Account forward, reject the whole mutation if any later Transaction now
fails, and name the first conflict.

**Why.** Decision 4 makes history mutable-but-fragile: deleting a funding
Deposit orphans the purchases after it. Replay is affordable — recomputing
FIFO fresh is already how every read and write works, and is
sub-millisecond at single-user scale (`docs/non-goals.md` § Caching
computed Position/Lot/gains).

**Rejected:** allowing the mutation and flagging damage — leaves the app
in a knowingly-wrong state every read path must handle. **Rejected:**
only allowing the most recent Transaction to change — makes fixing an old
typo impossible.

## 8. Demo data is seeded, and Reset is purge-and-reseed

**Decision.** A user with zero Accounts is seeded a demo portfolio on
first login. Reset deletes everything and reseeds.

**Why purge-and-reseed.** No `is_demo` flag, no selective cleanup, no
"first real account triggers removal" rule — all considered, all more
machinery than the problem deserves.

**Rejected:** an onboarding wizard (deferred), and pre-baked price
fixtures to avoid the first-launch fetch (the blocking fetch was accepted
instead; progressive rendering is #28).

---

## What this does not cover

Behavioural detail — ranges, granularity, chart interactions, search
grammar, Activity grouping, matrix scrolling — is in
[`behaviour.md`](../design/dashboard_v2/behaviour.md). Deferred features
and their reasoning stay in [`docs/non-goals.md`](../non-goals.md).
