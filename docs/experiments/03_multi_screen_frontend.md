# Experiment 03 — Multi-screen frontend

**Tests:** the "no state management library" rule survives at scale — local useState + refetch + minimal context holds for 5+ screens with shared data, deep links, navigation state, and a non-trivial UI.

**Status:** ⏳ Not yet run.

---

## The prompt (copy verbatim into a fresh Claude Code session)

```
Build a 5-screen Expo web app on top of this skeleton's existing
backend. The screens:

  - Home: list of items, filterable by tag
  - Item detail (deep-linkable by id)
  - Item edit
  - Add new item
  - Tags list (each tag links to home filtered by that tag)

Add whatever backend endpoints you need (edit, delete, tags list)
following the skeleton's existing pattern.

Read CLAUDE.md and docs/architecture.md before touching anything —
they describe the layering, testing, conventions, and commands. If
something there is unclear, ask before inventing.

Definition of done:
  - I can navigate all 5 screens
  - Editing an item shows the updated value when I navigate back
  - Opening /items/<some-id> directly in a browser lands on the
    detail screen with that item loaded (deep linking works)
  - Clicking a tag on the tags screen lands on the home filtered
    by that tag
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
  7. **Specific to this experiment:** at what point (if any) did the
     no-state-management rule start to feel painful? Where would a
     state library actually help? What did you do instead?

Be honest, including about places where you went back and fixed
something mid-course.

Do NOT start any dev server.

Go.
```

---

## What passing looks like (for the maintainer to use after the run)

### Hard gates (binary)

- `just verify` exits 0 with the new web tests included
- All 5 screens exist as files under `apps/mobile/app/`
- Deep linking works (manually verify by opening `/items/<some-id>` in a browser)
- `grep -rE "(redux|zustand|jotai|recoil|tanstack|swr|mobx|valtio)" apps/mobile/` returns zero matches
- `grep -rE "(react-native-paper|nativewind|tamagui|gluestack)" apps/mobile/` returns zero matches

### Soft signals (judgment calls)

- Each screen file is small — under ~150 lines is healthy. Above ~300 lines suggests the agent is fighting the no-state-mgmt rule with verbose workarounds
- `useFocusEffect` is used wherever a screen needs to see updates from sibling screens
- Form state stays local to its screen
- `lib/api.ts` gains the new endpoints cleanly — no leaking session state
- Tag filter uses `useLocalSearchParams()` for deep linking, not local state alone
- Back navigation through the chain feels native
- Did the agent add a Playwright test for multi-screen navigation? It wasn't explicitly required, but a thoughtful agent would extend the web tier

### Skeleton-improvement signals — things to watch for in the RETRO

- **Where do custom hooks live?** If the agent introduces `useItems()` or similar, where? `apps/mobile/lib/hooks/`? Inside the screen file? Worth codifying.
- **Did `useFocusEffect` get reached for naturally?** Or did the agent invent something else first?
- **The `/tags → /?tag=foo` deep link** — does the pattern (`router.push({ pathname: '/', params: { tag } })`) fall out of the agent's reading of expo-router docs, or did they get stuck?
- **Did the agent extend the web test tier?** Adding a Playwright multi-screen flow test is the natural way to validate the deep-linking works — did they think to do it?

### Things that would justify a skeleton fix

- **"Local useState + refetch IS painful at this scale, here's where"** — if the RETRO surfaces specific cases where the rule is hostile, that's evidence to revisit it. The skeleton's "no state management library" stance is opinionated; this experiment is the test of whether the opinion holds at the 5-screen mark.
- "I had to fight expo-router's typing"
- "useFocusEffect doesn't cover case X"

## Findings (fill in after the run)

> **Run on:** _date_  
> **Agent:** _Claude version_  
> **Final commit:** _sha_  
> **Verify status:** _green / red / partial_  
> **Skeleton bugs surfaced:** _list_  
> **Promotable patterns:** _list_  
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
