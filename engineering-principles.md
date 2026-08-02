# Engineering Principles

This is the fork's durable engineering north star, capturing the taste calls made during the portfolio-tracker design session — not a restatement of `CLAUDE.md`'s layering rules, which remain the source of truth for the backend architecture.

## Engineering Promise

Every field, endpoint, and abstraction exists for an explicit, traceable reason — nothing is added for a hypothetical future need, and nothing important (misuse, absence, invalid states) is left implicit.

## Related Docs

- [`docs/architecture.md`](docs/architecture.md) — backend layering (unchanged, inherited from the skeleton).
- [`docs/domain-model.md`](docs/domain-model.md) — entities, FIFO invariants, the query interface's primitive/composite metric design.
- [`docs/auth.md`](docs/auth.md) / [`docs/security.md`](docs/security.md) — real auth as a v1 requirement and why.
- [`docs/environments.md`](docs/environments.md) — the two-toggle, four-cell dev/test/prod model.
- [`docs/non-goals.md`](docs/non-goals.md) — what was deliberately cut, and why.
- [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) — the domain glossary.

## Technical Principles

- **Compute, never store, derived facts.** `Position`, `Lot`, gains, and every query-interface `Metric` are pure functions over the `Transaction` ledger — never persisted, never able to drift from it.
- **Domain invariants belong in the type/function, not caller discipline.** The `pofo` reference implementation's FIFO matcher was only correct because every call site happened to pre-filter by account/instrument; this rewrite asserts that invariant explicitly (`docs/domain-model.md`). If a rule can be violated by a careless caller, it isn't really enforced.
- **Closed enums over open-ended generality.** The query interface's `Metric` is a fixed, finite set — a primitive fold or raw pass-through, or a composite of exactly two primitives. It intentionally stops short of being a formula/expression language, even though that would technically "generalize further" — that generalization wasn't asked for and isn't needed.
- **One name per concept, always.** The `pofo` reference implementation had `PositionMatchingStrategy` (an enum) and `PositionMatchingStrategy` (an unrelated, dead ABC hierarchy) coexisting; `RealizedGain` and `Instrument` had the same collision. This rewrite treats a naming collision as a defect, not a style nit — see `UBIQUITOUS_LANGUAGE.md`'s "Flagged ambiguities."
- **Resolve configuration once, inject everywhere.** Auth and persistence adapters are each selected exactly once, at `lifespan` startup — no `if settings.x ==` scattered through request handling (`docs/environments.md`).
- **Dev velocity and production security are structurally separate, not a discipline.** `MYAPP_AUTH=stub` is fast and login-free for local dev; it is hard-rejected by a startup config check when `MYAPP_ENV=production`, not merely documented as unsafe.
- **Ship-cut decisions get written down with their reasoning, not just their conclusion.** See `docs/non-goals.md` — every deferred feature states *why*, so "not built" reads as a decision made once, not a question to re-litigate each session.

## Type And Nullability Taste

- Closed enums for closed sets: `AssetClass`, `TransactionType`, `AccountType`, `Metric`, `Mode`, `LotMatchingStrategy`.
- `Transaction.instrument_id` is never null — cash transactions reference the `CASH` instrument rather than omitting the field, so there's exactly one `Transaction` shape (`docs/domain-model.md`).
- Cross-user absence is deliberately indistinguishable from non-existence at the API boundary (404, not 403 — `docs/auth.md`) — this is a modeled security decision, not an accident of REST convention.

## Durable Technical Non-Goals For Now

See [`docs/non-goals.md`](docs/non-goals.md) for the full list with reasoning (corporate actions, CSV import, multiple price providers, cron sync, LIFO/highest-cost matching, inter-account transfers, the conversational interface, multi-user).

## Known Enforcement Gaps

- Backend layering is enforced by convention and review, per `CLAUDE.md` — unchanged by this fork.
- The per-account FIFO invariant and the closed `Metric` enum are enforced in code (raise/reject on violation), but there's no static check preventing a future PR from reintroducing a caller-discipline-only invariant elsewhere — code review is the backstop.
- RLS policy correctness is only proven by the dedicated real-Postgres test tier (`docs/security.md`) — a policy bug in a code path that tier doesn't exercise would not be caught by `stub`-mode dev/CI runs, since those bypass RLS via the service-role key.

## Updating This Document

Update when a feature brief, ADR, or implementation decision changes durable engineering direction. Implementation-specific concerns expected to close soon belong in a feature brief or ticket, not here.
