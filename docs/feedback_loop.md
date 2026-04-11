# Skeleton feedback loop

How this skeleton gets hardened over time: dogfood-driven validation via increasingly complex experiment projects.

## Why this loop exists

The skeleton only gets better by being used. Reading the code and nodding doesn't catch:

- The rules that CLAUDE.md *thinks* it enforces but actually doesn't (agent ignores, docs are too quiet, prompt ambiguous)
- The places where `just new-project` missed a file
- The friction points that only show up when someone tries to build something real
- The "obvious" defaults that become annoying at scale

Every experiment that finds a paper cut becomes a skeleton improvement. Every successful experiment without incident is evidence that a convention is load-bearing enough to survive.

## The loop

| Step | Who | What |
|---|---|---|
| 0 | maintainer | Snapshot current skeleton state — what's committed, what's open |
| 1 | user | Fork the skeleton (`git clone` + `just new-project <slug>`) and run a validation experiment — paste a natural-language spec into a fresh Claude Code session |
| 2 | user | Manually test the resulting app end-to-end |
| 3 | user → maintainer | Share the result: git log, diff, `just verify` output, manual-test notes, optionally conversation log |
| 4 | maintainer | Assess what the skeleton enforced vs what it didn't. Propose targeted improvements (CLAUDE.md, scripts, recipes, docs). |
| ↻ | | Loop back to step 0 with the improvements landed. Next experiment is harder or tests a different axis. |

## Complexity ladder

Each experiment should be meaningfully harder than the last, OR test a different axis (domain, frontend, deploy, external integration, etc). Don't skip rungs — each generation's findings inform what to build or tighten before the next.

| Generation | App | Axis tested |
|---|---|---|
| v1 | TODO list (add, toggle done, delete, filter by tag) | Basic CRUD + four-tier test pyramid + "from natural language" flow |
| v2 | Same TODO list, re-run after skeleton improvements | Regression check — did improvements hold? |
| v3 | Home inventory tracker (expiry dates, value, waste/savings math) | Multi-entity, non-trivial service-layer math, state transitions, invariants |
| v4+ | TBD | Candidates: auth, SQL adapter, file uploads, real external integration, multi-user state |

## What to share in step 3

### Required (minimum useful signal)

```bash
cd ~/git_projects/<experiment-project>
git log --oneline           # commit discipline — how many, what order, message quality
git diff <base>..<head> --stat   # file change scope
just verify 2>&1 | tail -30      # did it end green
```

Plus **manual test notes** — a few sentences on what you actually did in the UI and what worked / didn't.

### Very helpful (if easy)

- Backend source diff: `git diff <base>..<head> apps/api/src/`
- Grep for convention violations: `grep -rn "mock\|@patch" apps/api/tests/`
- Paths of the test files the agent created — mirror convention respected?
- Output of `grep -rn "myapp" apps/` — any stale references the rename missed?

### Bonus (if you feel like it)

- Raw conversation log from the Claude Code session
- Screenshots of interesting moments — Claude asking a question, choosing a design, hitting an error
- A note on cost/time — how long did it take, how much token budget

### Not needed

You don't have to summarize or analyze anything. Raw outputs are fine. The maintainer does the synthesis in step 4.

## What the assessment (step 4) looks for

### Did CLAUDE.md hold?

- **Layering** — did domain stay framework-free? Did business logic stay in `service/` rather than leaking into `entrypoints/`?
- **Testing philosophy** — `FakeRepository` only, no mocks, round-trip integration tests, tiered correctly?
- **File locations** — mirror convention for unit tests in `tests/unit/<layer>/test_*.py`?
- **"Adding a new resource" ordering** — did the commit trail follow the domain → service → adapter → tests → route → integration order?
- **Did Claude ask questions** about unclear docs, or invent conventions silently?

### Did the skeleton make the easy things easy?

- Did `just new-project` work end-to-end without manual patches?
- Did `just verify` catch issues at the right granularity?
- Was install fast (lockfiles helping)?
- Did CI pass on push?
- Did the agent hit any gotcha we already know about (stale Metro, orphan processes, port contention)?

### What needed prompt-level restating?

- Anything the user had to repeat in the prompt is a candidate for promotion into CLAUDE.md or `docs/`.
- Conversely, things that worked *without* restating are validation that the skeleton's docs are load-bearing.

### What's unexpectedly novel or interesting?

- Did the agent make a good design call that CLAUDE.md didn't mandate? Promote it to the "adding a resource" example.
- Did the agent hit a class of bug we haven't seen before? Add it to troubleshooting.

## Kinds of skeleton changes that come out of step 4

| Finding | Typical fix |
|---|---|
| Stale hand-curated list (e.g. FILES in a script) | Convert to glob / discovery |
| Missing command | Add a `just` recipe |
| Rule that keeps getting violated | Move from implicit to explicit in CLAUDE.md, possibly with a worked example in `docs/` |
| Rule that keeps getting followed silently | Celebrate, leave alone |
| Recurring friction or confusion | Add a troubleshooting doc (like `bootstrap.md`) |
| Feature gap the experiment needed | Decide: build into the skeleton, or document how to add it |
| Agent did the wrong thing by default | Make the right thing the path of least resistance (recipe, helper, CLAUDE.md rule) |

## Principles that have emerged so far

These are session-learned rules of thumb — not laws, but strong defaults until evidence says otherwise.

1. **Default to maximum quiet.** Anything the skeleton ships "on by default" is something the first user pays for. Prefer opt-in (e.g. `deploy-backend.yml` is `workflow_dispatch` only by default).
2. **CLAUDE.md is the contract.** If a rule matters, it's in CLAUDE.md. If it's in CLAUDE.md, it has to survive prompts that don't restate it. Duplicating rules in prompts is a smell — it means CLAUDE.md isn't load-bearing enough.
3. **Commit cadence matters.** Per-milestone commits give reviewable diff trails and cheap rollback. Squashing an experiment into one giant commit destroys the signal step 4 needs.
4. **The skeleton only knows what it's been stressed with.** A pattern untested is a pattern unreliable. The experiment is the test; a green baseline after `just new-project` is the gate.
5. **Operator error before complex defenses.** When a bug seems to need elaborate mitigation, first verify it's not wrong-directory / stale-buffer / not-the-process-you-think. Don't pile on pkills and retry loops to work around a PEBKAC.
6. **Wrap + whitelist for permissions.** When a command would otherwise need `Bash(cmd *)` wildcards (which are injection-prone), wrap it in a `just` recipe and allowlist the recipe name instead — exact-match, no injection surface, code-reviewed in the justfile.
7. **Reviewable atomic changes.** Even fast fixes get their own commit with a specific message. The git log is the audit trail for "why does the skeleton look like this?"

## Anti-principles (things we tried and walked back)

- **Don't over-engineer defenses based on guesses.** Session example: I tried to make `just clean` kill orphan processes + handle race conditions, when the actual bug was the user was editing files in one directory and running commands in another. Rolled back to a 3-line `clean` + separate `kill` recipe.
- **Don't prescribe adapter shape in advance.** Started to design a "mapper" module pattern borrowed from pofo; caught that it overfits SQL and unnecessarily biases the skeleton. The repository ABC is the abstraction; each adapter does its own assembly internally.
- **Don't mirror memory into committed docs.** Memory in `~/.claude/` is personal; `docs/` is curated. Duplicating them creates drift.
- **Don't check in "design docs" that describe a plan in-flight.** Delete after execution, or don't write them. `docs/testing.md` is the durable artifact from the test pyramid plan; the plan doc itself got deleted after rollout.

## Adding a new experiment to the ladder

When you want to add a new rung:

1. Describe the app in 3–5 sentences — what, for whom, why it tests a new axis
2. Identify what CLAUDE.md rule or skeleton capability it stresses that previous experiments didn't
3. Write the prompt using the template below — preamble and retro are reusable verbatim; only the spec body changes
4. Run it as a full cycle (steps 1–4)
5. Update the complexity ladder table in this doc with the results

## Experiment prompt template

Every experiment prompt has the same shape: a **preamble** that defers to CLAUDE.md, a **spec body** (the actual experiment), and a **retro suffix** that captures process signal. Preamble and retro are reusable verbatim across experiments; only the spec body changes.

### Preamble — copy verbatim

```
CLAUDE.md has the layering rules, testing conventions, file-path
conventions, commands, and "adding a resource" ordering. Follow it —
I'm not restating it here. If something in CLAUDE.md is unclear, stop
and ask before inventing a convention.
```

This is the single most load-bearing block of any experiment prompt. It:

- Tells the agent where the rules live
- Explicitly says "I'm not restating them" so the agent doesn't expect them inline
- Forces "ask before inventing" to surface ambiguity rather than silently papering over it

**If you catch yourself wanting to add "no mocks" or "domain must be framework-free" or "tests go in tests/unit/service/" to an experiment prompt, stop.** Those are in CLAUDE.md. If they're not working, the fix is to strengthen CLAUDE.md, not to patch around it in every prompt. Prompt-level duplication is a skeleton smell.

### Spec body — varies per experiment

Suggested structure:

- **One-line purpose** — "Build a X tracker..."
- **What users can do** — features as bullets, specific enough to implement
- **Derived status / computed fields** — anything that should be computed, not stored
- **Required behaviors** — layer-agnostic; don't prescribe where methods live (that's the skeleton's judgment test)
- **Invariants** — rules the system must enforce
- **Scope** — in-memory? single-user? deliberate out-of-scope items? frontend constraints not in CLAUDE.md (no state libs, no UI libs)
- **Definition of done** — concrete observable criteria (verify passes, manual test steps, math consistency, "looks like it belongs" check)

**Don't include:** layering rules, testing conventions, file-path conventions, commit cadence, command reminders, "no mocks", "read CLAUDE.md first". All of those are in CLAUDE.md already and duplicating them weakens the experiment's validation power.

### Progress + retro suffix — copy verbatim (mildly recommended)

This block asks the agent to maintain **two** side-channel files: a live `LOG.md` that grows as work happens, and a post-hoc `RETRO.md` written at the end. Both are gitignored — they're signal for the skeleton maintainer, not part of the app.

```
As you work, maintain a progress log at LOG.md in the repo root (do
NOT commit it — leave it untracked). Append one entry per significant
action — reading a doc, writing a file, running a recipe, hitting an
error, making a decision. Entries look like:

  ## <n> — <one-line action>
  **Why:** <reason>
  **Outcome:** <result, including failures>

Keep LOG.md **append-only**. Never rewrite previous entries. If a
step turns out to be wrong, add a new entry explaining the correction
and reference the earlier entry by number. The log is ground truth
for what happened in what order, including mistakes.

Before reporting done, write a retrospective to RETRO.md at the repo
root (also NOT committed — leave untracked). Cover:

  1. Which files from CLAUDE.md and docs/ did you actually read, and
     when? (At the start? When you hit a decision? Never?)
  2. Which `just` recipes did you run, in order? One-line reason each.
  3. Architectural decisions you made that weren't explicitly in the
     spec — where you placed methods, how you modeled entities,
     anything you had to invent because the docs didn't cover it.
  4. Rules you noticed in CLAUDE.md but had to consciously work around
     or ignore, and why.
  5. Questions you wanted to ask but didn't — how did you decide
     instead?
  6. What would you add to CLAUDE.md or docs/ based on building this?
     Rules that were unclear, things you had to guess, patterns worth
     codifying.

Be honest, including about places where you went back and fixed
something mid-course. Both files go to the skeleton maintainer to
harden the docs for the next experiment.
```

Why two files, not one:

- **LOG.md is ground truth.** Append-only discipline means it records what actually happened, including failures, not just what the agent wants to present. The user can `tail -f LOG.md` in another terminal to watch progress live.
- **RETRO.md is reflection.** Post-hoc synthesis — the agent's interpretation of what it did, what was hard, what the skeleton should tighten. Valuable even though it's self-reported.
- **Cross-checking.** If RETRO says "I ran `just verify` after each milestone" but LOG only shows it twice across eight milestones, that's a divergence worth noting in step 4.

Why "mildly recommended" not required: both are self-reported process data, not outcome data. The agent might forget to append, or rationalize post-hoc. But even imperfect process data is much better than none — include the block for any experiment where you want to assess CLAUDE.md effectiveness in step 4.

### `.gitignore` note for experiments

After running `just new-project`, a quick manual step: append `LOG.md` and `RETRO.md` to `.gitignore` so the agent's side-channel files don't accidentally get staged. (Or: rely on the agent to be disciplined about not committing them — both are acceptable.)

### Full prompt shape

```
<one-line purpose, e.g. "Build a home inventory tracker in this repo.">

<preamble block — verbatim>

What users can do:
  - ...

Derived status (computed, not stored):
  - ...

Required behaviors (you decide which layer each belongs in):
  - ...

Invariants:
  - ...

Scope:
  - ...

Definition of done:
  - ...

<retro suffix block — verbatim>

Go.
```

This is the template. v3 (home inventory) was the first experiment to use it fully; future experiments should copy-paste the preamble and retro verbatim, fill in the middle, and run.

## Related

- [`architecture.md`](architecture.md) — the layering design this skeleton enforces
- [`testing.md`](testing.md) — the four-tier test pyramid experiments exercise
- [`bootstrap.md`](bootstrap.md) — install + worktree troubleshooting (common step-3 blocker for first-time forks)
- [`CLAUDE.md`](../CLAUDE.md) — the agent contract that experiments validate
