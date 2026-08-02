# Experiment ladder — current state + reasoning

Working notes on why the ladder is shaped the way it is. Not committed. The canonical state is `docs/experiments/INDEX.md`; this file captures reasoning that doesn't belong in the committed index.

## Current state (2026-04-11)

| # | Experiment | Status | Notes |
|---|---|---|---|
| 01 | Persistence (SQLite) | ✅ Fully closed | 3 runs: v1 baseline → v2 round-1 docs → v3 cross-link. Convergence detected via RETRO §6 severity drop (major → medium → polish). |
| 02 | Auth (JWT) | 🟡 v1 done, v2 pending | v1 at `~/scratch/v4-03-multi-screen/` (mis-named dir). v2 running now against new architecture.md § "Layering" + CLAUDE.md web-test rule. |
| 03 | Multi-screen frontend | 🟡 Running in parallel with 02 v2 | First run, against new docs. Web-test rule is the main thing to watch. |
| 04 | External API adapter | ⏳ Not yet run | Bridges to pofo. Tests rule 4 against non-storage adapters. |
| pofo | Final boss | ⏳ | Real app. Portfolio tracker. ~11k Python + ~9k TS. |

## Why 04 is "external API adapter" and not file uploads

Earlier I thought the next experiment should be **file uploads** — the single most common missing piece for "real apps." Pofo survey changed that. Pofo has:

- No file uploads
- No payments
- No websockets
- No background jobs

What pofo **does** have that the skeleton doesn't:

- **yfinance as an adapter** — the skeleton has zero story for network-backed adapters today. This is the single biggest gap to pofo.
- **MCP server** — a dual API surface alongside FastAPI. Probably belongs in pofo itself, not as a pre-pofo experiment — MCP wiring is mostly mechanical once the service layer is clean.

So 04 swapped from "file uploads" to "external API adapter." The design question is: does the ABC/adapter pattern generalize when the adapter is talking to `httpx`, not `sqlite3`? Rule 4 claims yes. 04 is the test.

**File uploads are deferred.** If pofo doesn't need them and the skeleton validation ladder doesn't need them, they don't deserve an experiment. They can be a future experiment (05?) if a real use case appears.

## Why 03 + 04 can run in parallel but 01/02 couldn't

01 and 02 are **stacked**: auth depends on persistence being real (you can't meaningfully validate auth against memory-only storage — the whole point of auth is that your data survives a restart). So 01 had to close before 02 could run.

03 (multi-screen frontend) and 04 (external API adapter) are **independent axes**: frontend scaling doesn't interact with backend adapter shape. An agent running 03 never touches `adapters/`; an agent running 04 never touches `app/*.tsx`. Safe to parallelize.

## Why not run v4-02 v2 and v4-03 in the same shot

They're also independent, which is why they're running in parallel right now. But they exercise different parts of the docs:

- v4-02 v2 tests the **architecture.md § "Layering"** section (rules 1–4) and the **CLAUDE.md web-test rule** (one bullet).
- v4-03 tests **existing frontend conventions** (no state management library, local useState + refetch, Playwright tier) and the **CLAUDE.md web-test rule** (same bullet).

The web-test rule is the overlap. Both runs should extend `tests/web/` — if neither does, that's a docs failure. If both do, it's a strong signal.

## Convergence heuristic (from v4-01)

v4-01 ran 3 times. The decision to stop iterating came from watching **RETRO §6 severity drop**:

- v1 RETRO §6: 4 items, all major discoverability gaps
- v2 RETRO §6: 3 items, medium gaps
- v3 RETRO §6: 4 items, all polish — no discovery failures

Count stayed constant, severity dropped. That's convergence. Stop there.

**Apply to 02/03/04:** the goal of iteration is to see severity drop across runs. If v4-02 v2 comes back with "I didn't find docs/testing.md" or "I re-derived owner-scoping because the ABC didn't show the shape," that's a major gap and we need round-3. If v4-02 v2 comes back with "the four rules gave me the exact shape; my RETRO §6 is polish items," we can close it and move on.

## What to watch for in 02 v2 and 03

### 02 v2 — signals the docs are working

- Agent cites `docs/architecture.md § "Layering"` in RETRO §1 (not just architecture.md generally)
- `get_current_user` lands in `entrypoints/` on first try (not moved around)
- Service methods take `owner_id: str`, not `User` or `current_user`
- `tests/web/` gets an auth-flow spec unprompted
- RETRO §6 is polish-only (< 3 items, all minor)

### 02 v2 — signals the docs need a round-3

- Agent re-derives the owner_id pattern from scratch (didn't find the rules)
- Agent reaches for contextvars or `request.state` (Rule 1 unclear)
- No Playwright spec added despite adding 3 UI states (web-test rule unreachable)
- RETRO §6 has major items we already thought we fixed

### 03 — signals the docs are working

- Agent respects "no state management library" without complaining
- Refetch pattern used for cross-screen data, not a global store
- Every new screen gets a Playwright spec
- RETRO §6 polish-only

### 03 — signals round-2 needed

- Agent reaches for Redux/Zustand/Jotai and justifies it in RETRO
- New screens added but no web tests
- Navigation state duplicated across files (convention missing)

## If both pass cleanly

Run 04. Then pofo.

## If either surfaces gaps

Land fixes, re-run (the gap-surfacing one only). Don't re-run both unless the fix affects both.
