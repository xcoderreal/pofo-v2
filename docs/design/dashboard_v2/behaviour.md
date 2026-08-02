# Dashboard v2 — binding behaviour

The design prototype's behaviour is **binding**; its copy and visuals are
**directional**. That split was decided deliberately (see
[`docs/adr/0001-dashboard-v2.md`](../../adr/0001-dashboard-v2.md), Q2):
the state machine is the expensive-to-rediscover part and is testable,
whereas pinning hex values and comma placement invites review cycles
about nothing.

So: treat everything in this file as acceptance criteria. Treat exact
strings and colours as sensible defaults to use unless React Native
fights them.

**Precedence: this file and [ADR-0001](../../adr/0001-dashboard-v2.md)
outrank the prototype.** They encode the design-interview decisions,
which are the ground truth. The prototype is a *rough reference* — it
has its own glitches (YTD hardcoded to 213 days, a 731-day mock history
masquerading as a "2Y" limit, fabricated deposits to dodge the cash
question) — so where it disagrees with this file, this file wins.
Interpret its intent, don't transcribe its bugs.

[`prototype-source.js`](prototype-source.js) — 640 lines of real logic,
not a mockup — is what you consult where this digest is *silent or
ambiguous* about an interaction's mechanics (exact thresholds, ordering,
what clears what). Re-derive it with `extract-prototype.py` if you
suspect this digest mis-describes it — then fix the digest, unless the
divergence was an interview decision recorded here or in the ADR.

## Navigation and scope

Three destinations: **Portfolio**, **Grid**, **Activity**.

The Portfolio tab has four *levels*, determined entirely by which of
instrument/account are selected — not by a separate route:

| Instrument | Account | Level | List shows |
|---|---|---|---|
| — | — | `portfolio` | Holdings or Accounts (tabbed) |
| — | set | `account` | Holdings in that account, cash row first |
| set | — | `instrument` | One row per account holding it |
| set | set | `slice` | That single holding |

Selection is made by tapping a row, a Grid cell, or applying a search
slice. Active selections render as dismissible **chips**.

### Auto-adjustments (silent, intentional)

The prototype quietly repairs metric/scope mismatches in both
directions. All four are binding:

1. Opening an account holding **no instruments** switches the metric
   `equity → cash_balance`.
2. Selecting an instrument while on `cash_balance` switches back to
   `equity`.
3. Choosing a metric with **no account dimension** (`market_price`)
   while an account is selected **clears the account chip**.
4. Choosing a metric with **no instrument dimension** (`cash_balance`)
   while an instrument is selected **clears the instrument chip**.

3 and 4 were added during the interview — the prototype computes locally
and ignores the irrelevant dimension, but the API rejects the mismatch
with a 400, so the UI must resolve it first. Both raise the Undo toast.

Conversely, a metric that needs a dimension you **don't** have
(`share_count`, `market_price` with no instrument selected) is
**disabled**, with the reason shown inline — the app cannot guess which
instrument was meant.

### Undo toast

Clearing a filter snapshots the **entire** view state — level, scope,
metric, range, granularity, tab, cumulative flag — and shows a toast with
Undo for **5 seconds**. Undo restores all of it, not just the chip.

## Chart

Three interaction modes, from one pointer gesture:

- **Scrub** — drag. Crosshair follows; readout shows value at that point,
  change vs. the previous point, change from range start, and the point's
  date.
- **Pin** — a press that moved less than ~6px. Readout shows change from
  range start and invites a second tap.
- **Compare** — with one point pinned, tapping a *different* point pins a
  second and shades the band between. Readout becomes the A→B delta and
  percent, labelled with both dates.

Tapping the single pinned point again clears it. Changing range,
granularity, metric or scope clears pins.

**Nearest-point resolution is from the pointer's x-position against real
timestamps** — never the array index. The query interface returns sparse,
real-timestamped points and deliberately does not gap-pad non-trading
days, so index-based spacing would misplace every point after a gap.

### Metrics

Seven, matching the query interface's closed enum:

| Metric | Kind | Notes |
|---|---|---|
| `equity` | Level | Default. Excludes CASH at `"all"` scope |
| `cash_balance` | Level | No instrument dimension |
| `unrealized_gain` | Level | |
| `realized_gain` | **Flow** | Bars, not a line. Per-period or cumulative |
| `cost_basis` | Level | |
| `share_count` | Level | Requires one instrument |
| `market_price` | Level | Requires one instrument; no account dimension |

`realized_gain` is the only Flow: it renders as bars around a zero
baseline, its headline figure is the total booked across the visible
range, and its sub-line reports the range and bucket count rather than a
percentage — a percentage against a flow's first bucket is meaningless.

### Ranges and granularity

`1W · 1M · 3M · 6M · YTD · 1Y · Max` plus Custom. **`2Y` was dropped** —
it was an artifact of the prototype generating exactly 731 days of mock
history — and replaced with `Max`, resolved to the earliest transaction.

`YTD` is computed from Jan 1 of the current year. The prototype hardcodes
it to 213 days, correct only on the day the mock was authored.

Granularity auto-selects from the **resolved span**, not the range key's
name, so `Max` and `Custom` need no table entries. Granularities too
coarse for the span are not selectable, with the reason shown.

## Search

A chip-based slice builder, not a text search. Four chip kinds: metric,
instrument, account, period. One chip per kind; adding a second of the
same kind replaces the first.

- **Space** commits the typed token when it unambiguously matches one
  thing. An exact symbol match commits immediately even if other things
  also match.
- **Backspace** on empty input **arms** the last chip (highlights it);
  a second press deletes it. One press never destroys a chip.
- A **preview** shows the destination's title, subtitle and resulting
  value before applying.
- **Enter** applies and navigates.
- Three recents persist across sessions.

Search covers **only what the user owns** — held instruments, their
accounts, metrics, periods — and says so on a no-match. Market-wide
instrument lookup is a separate creation surface, not part of this
grammar: typing `AAPL` when you hold none cannot mean both "navigate to
my AAPL slice" and "create the AAPL instrument".

## Activity

Month-grouped, newest first, each group headed with its net cash
movement. Badges: `BUY`, `SELL`, `DEP`, `WDL`. Sells show realized gain.

**Suppression rule.** Every trade auto-posts a paired CASH leg carrying a
`trade_id`. Those legs are **hidden** — showing them would roughly double
the feed and put a phantom cash movement beside every trade. A CASH
transaction *without* a `trade_id` is a genuine Deposit or Withdrawal and
renders with its badge.

This is a predicate on a stored field. It must not be inferred from
matching account/timestamp/amount, which collides on same-day trades of
equal value.

## Grid

Total tile (`equity + cash_balance` — non-overlapping, since equity
excludes CASH), allocation bar by account, instrument × account matrix,
account list with sparklines.

The matrix in the prototype is hardcoded to 4 accounts and 7 instruments.
Both limits are replaced: **every** instrument with a live position gets
a row, and a column appears for **every account holding at least one
instrument**. The account rule was implicit in the prototype's
`['a1','a2','a3','a4']` — cash-only and empty accounts were excluded
because their column would be all dots — and is now explicit. The
instrument cut had no rule behind it.

Both axes scroll; the symbol column pins during horizontal scroll.

## Percentages — two different meanings

The prototype shows two percentages that look identical and mean
different things: the header's is `(last − first) / first` over the
selected range; each row's is `(market value − cost basis) / cost basis`,
lifetime and range-invariant. Changing the range moved one and froze the
other, with nothing on screen explaining why.

**Resolved:** row percentages become range-scoped too, so everything on
screen moves together. A position that did not exist at the start of the
range has no denominator and renders `—` rather than a fabricated number.

## Known prototype gaps

The prototype has no screen for: login, account creation, instrument
creation, transaction edit/delete, price loading/failure states, or an
empty portfolio. All are specified in tickets #13–#29 and are **not**
governed by this document.
