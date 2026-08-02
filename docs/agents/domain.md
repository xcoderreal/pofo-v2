# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the product context and compact glossary index for this repo (single-context: one domain, the portfolio tracker, split across `apps/api` and `apps/mobile`).
- **`UBIQUITOUS_LANGUAGE.md`** at the repo root — the full domain glossary with definitions, aliases-to-avoid, relationships, and an example dialogue. `CONTEXT.md` is the index into this file; this is the source of truth for term definitions.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Doesn't exist yet; created lazily as real architectural decisions accumulate.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context (this repo, despite `apps/api` + `apps/mobile` being separate Turborepo workspaces — they share one domain, not multiple bounded contexts):

```
/
├── CONTEXT.md
├── UBIQUITOUS_LANGUAGE.md
├── docs/adr/                          ← not yet created; lazy
└── apps/
    ├── api/
    └── mobile/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `UBIQUITOUS_LANGUAGE.md` / indexed in `CONTEXT.md` — e.g. **Position** (computed aggregate), never conflated with **Lot** (one FIFO-tracked chunk); **Account** (the portfolio domain concept), never conflated with **User** (the auth identity); **Metric**/**Primitive Metric**/**Composite Metric** for the query interface's vocabulary. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-000X (...) — but worth reopening because…_
