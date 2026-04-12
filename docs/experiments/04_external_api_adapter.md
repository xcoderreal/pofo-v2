# Experiment 04 — External API adapter

**Tests:** the repository/adapter layering accommodates *a second kind of adapter* — one that talks to a network API instead of a database. The "invariant core, swappable edges" rule should hold for third-party integrations the same way it holds for storage backends.

**Status:** ⏳ Not yet run.

---

## The prompt (copy verbatim into a fresh Claude Code session)

```
Add a feature to this skeleton where each Item can optionally carry a
ticker symbol (e.g. "AAPL", "BTC-USD"), and the GET /items/{id}
response includes the current price for that ticker, fetched from a
real third-party API of your choice (yfinance, CoinGecko, a free
weather API with a city field instead — pick whatever has a no-auth
free tier).

Prices should be cached briefly (60s is fine) so repeated GETs don't
hammer the upstream.

Read CLAUDE.md and docs/architecture.md before touching anything —
they describe the layering, testing, conventions, and commands. Pay
particular attention to the "Layering: invariant core, swappable
edges" section and the four rules. If something there is unclear, ask
before inventing.

Definition of done:
  - An Item can be created with an optional ticker/symbol/city field
  - GET /items/{id} returns the item plus a current price (or weather,
    or whatever your chosen API returns)
  - Repeated GETs within 60s don't re-hit the upstream (verifiable by
    the test you write, not by trust)
  - Unit tests don't make real network calls
  - The integration tier doesn't make real network calls either
  - At least one test DOES verify the real upstream works — you decide
    which tier it belongs in
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
     especially: where does the third-party client live (adapters/?
     services/? somewhere else?), how did you structure the "real vs
     fake" split for tests, and where does caching live.
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
- `git diff main -- apps/api/src/myapp/domain/` shows ONLY plain dataclass additions — no `httpx`, no `requests`, no third-party client imports in domain
- `git diff main -- apps/api/src/myapp/service/` shows no direct third-party imports — the service calls through an abstraction
- Unit tests run in under 1s total (proves no real network calls)
- A fake/stub price-source implementation exists and is used by unit and integration tiers
- A real price-source implementation exists, lives under `apps/api/src/myapp/adapters/`, and implements the same interface as the fake

### Soft signals (judgment calls)

- The third-party client lives in **`adapters/`**, not in `service/` or `entrypoints/`. Same directory as `memory_repository.py`, same pattern (ABC in `domain/`, concrete in `adapters/`). This is the whole point of the experiment — does the agent see that an external API is "just another adapter" under the invariant-core rule?
- The abstraction is **an ABC named after the capability**, not after the vendor. `PriceSource` / `WeatherSource`, not `YFinanceClient` / `OpenWeatherClient`. The vendor name appears only in the concrete adapter filename.
- **Caching lives in the adapter**, not in the service layer. The service doesn't know there's a cache; the service just calls `price_source.get(ticker)` and trusts it to be fast enough. (The alternative — caching in the service — would mean every new adapter has to re-solve caching.)
- **Fake adapter is used by unit + integration tiers**. The real adapter is used by at most one tier (probably e2e). The test pyramid story from `docs/testing.md` § "Where adapter conformance lives" should apply unchanged — this is the test of whether that section generalizes from storage to non-storage adapters.
- The agent chose a no-auth free API. If they reached for one that needs an API key, they either stubbed it or added a `Settings` field plus `.env.sample` entry (the round-1 CLAUDE.md rule from v4-01).
- The agent did NOT introduce a separate "HTTP client factory" or "API base class" — the concrete adapter just instantiates `httpx.Client()` or whatever directly. (Watching for premature abstraction.)
- The agent followed the rule-of-three guidance from `architecture.md § "Layering"` — i.e., they didn't design a generic "ExternalApiAdapter" base class for hypothetical future third-party integrations. One concrete adapter, one ABC, done.

### Skeleton-improvement signals — things to watch for in the RETRO

- **Where did the agent put the ABC?** `domain/repository.py` is for storage-repository ABCs. Did they add the new ABC there (co-locating all ABCs), or did they create `domain/sources.py` or similar? Either could be right; whichever they picked is a candidate for codifying in `docs/architecture.md`.
- **What did the caching look like?** In-adapter dict with TTL? `functools.lru_cache` with a timestamp hack? A proper `cachetools.TTLCache`? The skeleton has no caching story today — the agent's choice is interesting signal about what feels natural.
- **How did the "real vs fake" split work for tests?** Did they follow the parametrized-adapter pattern from `docs/testing.md` § "Where adapter conformance lives"? Or did they invent something new? If the documented pattern doesn't fit non-storage adapters, that's a gap in testing.md.
- **Did the agent touch `entrypoints/api.py` beyond adding `get_repo()`-style wiring for the new adapter?** If they edited the route handler to stitch together item + price by hand, the service layer wasn't pulling its weight. Service should return the composite, not the handler.
- **What tier caught the real-upstream test?** Smoke? E2E? A new "external" tier the agent invented? The skeleton has no current guidance for "this test needs real network" and the agent's choice is signal.
- **Did the agent extend `tests/web/`?** The new feature changes what `GET /items/{id}` returns, and if it's surfaced in the UI at all, the web-test rule from CLAUDE.md applies. If they added UI but not a Playwright spec, that's a regression against the round-2 rule — worth flagging.

### Things that would justify a skeleton fix

If the agent had to fight the skeleton in any of these places, it's a real gap:

- "I didn't know where to put the ABC — `domain/repository.py` is named for repositories" → rename or add `domain/sources.py` convention
- "The ABC had to import `httpx.Response` or similar to describe return types" → the ABC should speak domain terms, not HTTP terms; that's Rule 4
- "I had to add `httpx` to the skeleton's dependencies and it wasn't clear whether that's allowed" → CLAUDE.md should say something about the dependency policy for adapters
- "I wanted to write an 'external API adapter' test pattern doc and there was nowhere obvious to add it" → `docs/architecture.md` § "Adding a new adapter" should cover non-storage adapters too, or `docs/testing.md` should grow a section
- "The test pyramid didn't have a natural home for 'does the real upstream work'" → tiers doc should name the convention

### What I'm specifically watching for

This is the **first experiment that introduces a non-CRUD, non-auth axis.** The four rules from the new `architecture.md § "Layering"` section claim to be stack-independent. v4-01 tested rule 2 (service layer framework-free) against SQLite. v4-02 tested rules 1–3 against auth. This experiment tests **rule 4** specifically: "the ABC fits the 90% case; the 10% case customizes its adapter."

A price fetcher is a 10% case — it's not CRUD. If the agent arrives at a `PriceSource` ABC in `domain/`, a concrete `YFinancePriceSource` (or equivalent) in `adapters/`, and a test story that mirrors the storage-adapter story, **the rule works**. If the agent has to invent a new layering convention, or if they give up and put `httpx.get()` in the service layer, **rule 4 is underspecified** and the docs need a worked example.

## Findings (fill in after the run)

> **Run on:** _date_
> **Agent:** _Claude version_
> **Final commit:** _sha_
> **Verify status:** _green / red / partial_
> **Skeleton bugs surfaced:** _list_
> **Promotable patterns:** _list_
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
