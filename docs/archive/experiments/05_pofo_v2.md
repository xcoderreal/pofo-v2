# Experiment 05 — Pofo v2 (portfolio tracker)

**Tests:** the skeleton's full stack — backend layering, multi-entity domain with complex business logic, FK relationships, external API adapter, TanStack Query hooks, multi-screen frontend — survives a real-world app with non-trivial domain math.

**Status:** ⏳ Not yet run.

---

## The prompt (copy verbatim into a fresh Claude Code session)

```
Build a personal portfolio tracker on this skeleton. Users manage
investment accounts, log buy/sell trades, and see positions with
current market values and capital gains.

Domain:
  - Accounts (brokerage, cash — a user can have multiple)
  - Instruments (stocks/ETFs, identified by ticker symbol like AAPL)
  - Transactions (buy or sell, linked to an account + instrument,
    with quantity, price, and date)
  - Positions (computed from transactions — how many shares of what,
    at what cost basis, using FIFO lot matching)
  - Capital gains (realized gains from sells, unrealized from current
    positions — both computed, not stored)
  - Current prices (fetched from a free API like yfinance or CoinGecko,
    cached briefly so repeated views don't hammer the upstream)

The portfolio must support flexible breakdowns across two dimensions
— instruments and accounts — so users can answer questions like:

  "How is AAPL doing across all my accounts?"
  "What's in my Schwab brokerage?"
  "How has my total portfolio changed over time?"
  "How has AAPL performed in my Fidelity account specifically?"

Concretely, the views should support:
  - By instrument (all accounts combined)
  - By account (all instruments in that account)
  - By account + instrument (one instrument in one account)
  - Portfolio value over time (one account, or all accounts)
  - Instrument performance over time (one or more instruments,
    in one or all accounts)

The UI must stay intuitive despite this dimensionality. Think:
a single portfolio dashboard with progressive drill-down, not 6
separate pages. Start with the "total portfolio" overview, let
users tap/click into an account or instrument to narrow the view.
The same screen structure should work for any combination — the
data hooks change, the layout doesn't.

Replace the existing Item + Category scaffolding with the domain above.

Read CLAUDE.md and docs/architecture.md before touching anything —
they describe the layering, testing, conventions, and commands. If
something there is unclear, ask before inventing.

Definition of done:
  - I can create accounts and instruments via the frontend
  - I can log buy and sell transactions
  - I can see my positions (shares held, cost basis, current value)
  - I can see capital gains (realized from sells, unrealized from
    current holdings)
  - I can view portfolio value by instrument, by account, and both
  - I can see how a portfolio (or a slice of it) changes over time
  - Current prices come from a real external API, cached
  - Unit tests cover the FIFO lot matching and capital gains math
  - `just verify` is green

As you work, maintain a progress log at LOG.md in the repo root
(do NOT commit it). Append one entry per significant action — reading
a doc, writing a file, running a recipe, hitting an error, making a
decision. Format:

  ## <n> — <one-line action>
  **Why:** <reason>
  **Outcome:** <result, including failures>

Keep LOG.md append-only.

Before reporting done, write a retrospective to RETRO.md at the repo
root (also not committed). Cover:

  1. Which files from CLAUDE.md and docs/ did you actually read, and
     when?
  2. Which `just` recipes did you run, in order? One-line reason each.
  3. Architectural decisions you made that weren't in the spec —
     anything you had to invent because the docs didn't cover it.
  4. Rules you noticed in CLAUDE.md but had to consciously work around
     or ignore, and why.
  5. Questions you wanted to ask but didn't — how did you decide?
  6. What would you add to CLAUDE.md or docs/ based on building this?

Be honest, including about places where you went back and fixed
something mid-course.

Do NOT start any dev server.

Go.
```

---

## What passing looks like (for the maintainer to use after the run)

### Hard gates (binary)

- `just verify` exits 0
- `git diff` shows NO Item or Category references remaining (scaffolding fully replaced)
- `git diff -- apps/api/src/myapp/domain/` shows ONLY plain dataclass additions — no Pydantic, no FastAPI, no SQLAlchemy, no third-party imports in domain
- `git diff -- apps/api/src/myapp/service/` shows no adapter imports, no FastAPI imports
- FIFO lot matching logic lives in `domain/` or `service/`, not in `entrypoints/`
- Capital gains computation is a pure function (testable without I/O)
- External price adapter lives in `adapters/` behind a domain-level ABC
- Unit tests exist for FIFO and capital gains math specifically

### Soft signals (judgment calls)

- **TanStack Query hooks** for all data fetching — screens never call `lib/api.ts` directly
- **Pages are thin** — each screen under ~120 lines, calls hooks, renders components
- **Component extraction** — shared components in `components/` when used by 2+ screens
- **Price source ABC** named after capability (`PriceSource`), not vendor (`YFinanceClient`)
- **Caching in the adapter**, not the service layer
- **Injectable client + clock** on the price adapter for unit testing (MockTransport or similar)
- **FakePriceSource** in `tests/fake_price_source.py` (or equivalent)
- **Playwright specs** for key flows: create account, log trade, view positions, view capital gains, drill down by account/instrument
- **testID props** on interactive elements for stable Playwright selectors
- **`hooks/` directory** with one file per resource (useAccounts, useInstruments, useTransactions, usePositions, useCapitalGains)
- **Loading/error states** handled uniformly via TanStack Query's `isLoading`/`error`
- **Drill-down UI** — progressive disclosure, not 6 separate pages. Dashboard → tap account → see instruments in it. Tap instrument → see performance. The same component/hook structure handles any slice.
- **Query param-driven filtering** — the breakdown dimensions (account_id, instrument_id) should flow through URL query params or route params, not component state. This makes drill-downs deep-linkable and back-button friendly.
- **Reusable position/gains components** — the same position table and gains summary component should work regardless of the filter slice (all accounts, one account, one instrument). Data hooks accept optional filter params; the component doesn't know which slice it's showing.

### Skeleton-improvement signals — things to watch for in the RETRO

- **Multi-entity service orchestration:** did the agent need a service that takes 2+ repositories? If so, how did they wire it? (This is the FK orchestration question we designed the Category example to answer.)
- **Computed vs stored:** positions and capital gains are computed from transactions. Did the agent store them (wrong) or compute on read (right)? If computed, is the computation pure (testable)?
- **FIFO lot tracking:** this is the hardest domain logic. Did it end up in `domain/` (ideal) or `service/` (acceptable) or `entrypoints/` (wrong)?
- **The breakdown API design:** how did the agent handle the dimensionality? One endpoint with query params (`GET /positions?account_id=X&instrument_id=Y`)? Or separate endpoints per slice? The single-endpoint-with-filters approach is cleaner and matches how `usePositions({ account_id, instrument_id })` naturally composes with TanStack Query's `queryKey`.
- **UI structure for drill-down:** did the agent build one dashboard with progressive drill-down (good) or 6 separate pages (bad)? How many shared components vs one-off screens?
- **Time-series data shape:** how does the "portfolio value over time" API work? Does the backend compute daily snapshots, or does the frontend derive them from transactions + historical prices? Backend-computed is simpler for the frontend but requires price history storage.
- **Hook composition:** with 6 breakdown combinations, did the hooks stay clean (one `usePositions` with optional filters) or multiply (usePositionsByAccount, usePositionsByInstrument, ...)?
- **Transaction lifecycle:** can you sell more shares than you own? Does the service validate this? Where does the validation live?
- **Price source cache TTL:** is it configurable or hardcoded? Is TTL testable (injectable clock)?
- **The "replace scaffolding" step:** did the agent cleanly remove Item + Category, or did it leave remnants?
- **Screens count + complexity:** how many screens? Are any over 150 lines? Did the agent extract components?
- **OpenAPI types:** did the agent run `just gen-api-types` and commit the result? Or did they forget and `check-api-types` caught it?

### Things that would justify a skeleton fix

- "I didn't know how to wire a service that takes 2 repositories" → document multi-repo service pattern
- "The `hooks/` convention wasn't clear for computed resources (positions aren't a CRUD endpoint)" → document computed-data hooks
- "I couldn't figure out where computed domain logic goes" → document the "pure function in domain, called by service" pattern
- "The Playwright reset was hard because I had 5 entities to clean up" → document multi-entity test reset pattern
- "TanStack Query cache invalidation was unclear when a transaction affects positions AND capital gains" → document cross-resource invalidation

## Findings (fill in after the run)

> **Run on:** _date_
> **Agent:** _Claude version_
> **Final commit:** _sha_
> **Verify status:** _green / red / partial_
> **Skeleton bugs surfaced:** _list_
> **Promotable patterns:** _list_
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
