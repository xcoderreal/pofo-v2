# Validation experiments

Tracking the next round of skeleton-hardening experiments. Each row links to a self-contained prompt file. To run an experiment:

1. Push the latest skeleton state (`git push origin main`)
2. Clone the skeleton into a scratch directory: `git clone <skeleton-url> ~/scratch/v4-NN-experiment-name`
3. `cd ~/scratch/v4-NN-experiment-name && just install`
4. Open Claude Code in the scratch dir
5. Paste this two-line wrapper prompt:

   ```
   Read docs/experiments/0N_NAME.md and execute it as the spec.
   Write LOG.md and RETRO.md as you work.
   ```

6. Let it run, then capture the result (git log, diff, just verify output, LOG.md, RETRO.md) for step 4 of the [feedback loop](../../MAINTAINING.md#the-loop)

> **Note for users (not maintainers):** if you forked this skeleton with `just new-project` to build a real app, this `docs/experiments/` directory should NOT be in your fork (the init script auto-deletes it). It's maintainer-only validation infrastructure. If you see it in a fresh fork, that's a bug worth reporting.

## The current ladder

| # | Experiment | Tests | Status | File |
|---|---|---|---|---|
| 01 | **Persistence adapter (SQL/Supabase)** | "Extend with persistence" story actually works — Memory → SQL adapter swap is one-line wiring, the layering survives a real database, FakeRepository remains usable for tests | ✅ Fully closed (3 runs: v1 baseline → v2 round-1 fixes → v3 round-2 cross-link) | [`01_persistence_adapter.md`](01_persistence_adapter.md) |
| 02 | **Auth middleware** | Layering accommodates cross-cutting concerns (request-scoped state, user context propagation) without leaking auth into the domain or service layer | ⏳ Not yet run | [`02_auth_middleware.md`](02_auth_middleware.md) |
| 03 | **Multi-screen frontend** | "No state management library" rule survives at scale — local useState + refetch holds for 5+ screens with shared data, deep links, navigation state | ⏳ Not yet run | [`03_multi_screen_frontend.md`](03_multi_screen_frontend.md) |
| 04 | **External API adapter** | Rule 4 of the layering doc holds for non-storage, non-CRUD adapters — a third-party price/weather fetcher is "just another adapter" and the test pyramid story generalizes from storage to network | ⏳ Not yet run | [`04_external_api_adapter.md`](04_external_api_adapter.md) |

## Status legend

- ⏳ **Not yet run** — experiment file exists, no validation run yet
- 🟡 **In progress** — currently running or paused
- ✅ **Passed cleanly** — `just verify` green, manual test green, no skeleton bugs surfaced
- 🟠 **Passed with caveats** — green but surfaced patterns worth promoting to baseline
- ❌ **Failed** — skeleton couldn't accommodate the experiment without significant rework

## Updating the table

When an experiment finishes, update its row's Status column with the result and link findings (or summary) inline. If the experiment surfaces skeleton improvements, file them as separate PRs/commits referencing the experiment number.

## Why these three, in this order

The complexity ladder so far:

| Generation | App | What it tested | Status |
|---|---|---|---|
| v1 | TODO list | Basic CRUD + 4-tier pyramid + natural-language flow | ✅ |
| v2 | Same TODO | Regression check after v1 fixes | ✅ |
| v3 | Home inventory | Multi-entity, service-layer math, time-based logic, state transitions | ✅ (with surfaced gaps that landed in v4 prep — Playwright web tier, frontend unit tier, philosophy doc, etc.) |
| **v4** | **3 candidates below** | The next axis of skeleton stress | ⏳ |

The three v4 candidates target axes the previous experiments **didn't touch**:

- **01 (Persistence)** — every prior experiment used `MemoryItemRepository`. The repository ABC has never actually had a non-memory adapter. The "swap one-line wiring" promise in `docs/philosophy.md` is **untested**. Most likely first thing real users hit.
- **02 (Auth)** — every prior experiment was single-user / no auth. Cross-cutting concerns (request-scoped context, user identity, permission checks) haven't been validated against the layering. Common second thing real users hit.
- **03 (Multi-screen frontend)** — every prior frontend was 1–3 screens with local state. Scaling beyond that with the "no state management library" constraint hasn't been validated. Common third thing real users hit.
- **04 (External API adapter)** — every prior adapter was storage (memory, SQLite). The claim that "adapter = swappable edge" should generalize to non-storage I/O — a third-party price/weather fetcher is just another adapter under Rule 4 of the new layering doc. Bridges to pofo (which uses yfinance as an adapter).

Run them in **order** when sequential: 01 first (persistence is foundational), then 02 (auth depends on persistence being real), then 03 + 04 can run in parallel (frontend-scale and external-API-adapter are independent axes).

## Capturing findings

When an experiment completes, fill in the **Findings** section at the bottom of the per-experiment file (`01_persistence_adapter.md`, etc.) inline. Don't create a sibling `.findings.md` — the experiment file is the canonical home for both the prompt and its result.

The raw-materials checklist (what to capture from the run before writing the findings) lives in [`MAINTAINING.md` § "What to share in step 3"](../../MAINTAINING.md#what-to-share-in-step-3). The per-experiment files have a "What passing looks like" section that lists hard gates, soft signals, and skeleton-improvement signals for that specific experiment — use those to judge what to call out in the Findings section.

After filling in Findings, also update this file's status table (above) for that experiment's row.
