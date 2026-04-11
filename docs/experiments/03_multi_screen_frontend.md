# Experiment 03 — Multi-screen frontend

**Tests:** the "no state management library" rule survives at scale — local useState + refetch + minimal context holds for 5+ screens with shared data, deep links, navigation state, and a non-trivial UI.

**Status:** ⏳ Not yet run.

---

## The full prompt (copy verbatim into a fresh Claude Code session)

```
Build a 5-screen Expo web app on top of this skeleton, exercising
expo-router's deep linking + navigation state. The backend stays
the in-memory item repository the skeleton ships with — this is a
frontend-stress experiment, not a backend experiment.

CLAUDE.md has the layering rules, testing conventions, file-path
conventions, commands, and "adding a resource" ordering. Follow it —
I'm not restating it here. If something in CLAUDE.md is unclear, stop
and ask before inventing a convention.

The five screens (each in apps/mobile/app/):

  1. /              — list of items (existing index.tsx, refactor as needed)
                      Filterable by tag. Each item is a Link to /items/[id].
  2. /items/[id]    — detail screen for one item. Shows everything,
                      has Edit and Delete buttons. The id is a deep link
                      param via expo-router's dynamic route segment.
  3. /items/[id]/edit — edit form for one item, prefilled with current
                        values. Submitting POSTs an update and navigates
                        back to /items/[id].
  4. /add           — add a new item. On success, navigates to
                      /items/[new-id] (NOT back to /).
  5. /tags          — list of all tags currently in use, each linking
                      back to /?tag=<tag> (which deep-links into the
                      filtered home view).

Backend additions you can make freely:
  - PATCH /items/{id} for updates (the skeleton currently only has
    GET / POST). Add the route + service method + integration test.
  - DELETE /items/{id} for deletes. Same.
  - GET /tags returning the unique set of tags across all items.

Frontend constraints:
  - NO state management libraries. No Redux, Zustand, Jotai, Recoil,
    TanStack Query, SWR, MobX, Valtio, anything else.
  - LOCAL useState + refetch on focus is the pattern. Each screen
    fetches its own data on mount/focus and re-fetches after any
    mutation.
  - You MAY use a single React Context if you need to share something
    that's truly global — but you probably don't. The list and detail
    screens can independently fetch their own data; the only thing
    that's "shared" is the backend itself.
  - NO UI component library. StyleSheet only.
  - Deep linking must work — opening /items/some-id directly in the
    browser should land on the detail screen with that item loaded,
    not on the home screen.
  - Back navigation must work — after navigating from / to /items/abc
    to /items/abc/edit, the back button should return through that
    chain in order. expo-router handles this for free; verify it
    actually does.
  - The /tags screen → click a tag → land on / with the filter active.
    This is a query-param navigation; useLocalSearchParams() reads it.

Test discipline:
  - Backend: integration tests for the new PATCH, DELETE, and GET /tags
    routes. Service-layer unit tests for the underlying methods.
  - Frontend unit tests: any pure-function logic that lands in
    apps/mobile/lib/ (URL-building helpers, tag-uniqueness logic, etc.)
    gets a test in apps/mobile/tests/unit/.
  - The Playwright web tier should still pass — the smoke test loads
    the home screen and asserts no runtime errors. Add a second
    Playwright test that exercises a multi-screen navigation flow:
    home → click an item → detail → click edit → fill form → submit →
    detail → back → home. Asserts each step landed on the right
    screen and no errors fired.
  - The new Playwright test goes in apps/mobile/tests/web/ as a
    sibling to smoke.spec.ts.

Rules of engagement (beyond CLAUDE.md):
  - Backend layering still applies — domain stays framework-free,
    business logic in services, etc.
  - The frontend test for multi-screen navigation is the interesting
    one. Make sure it actually navigates between screens, not just
    asserts on the home page.
  - If you find yourself reaching for a state management library
    "to make this cleaner," stop. The whole point of this experiment
    is to test whether the no-state-mgmt rule holds. Document the
    pain in the RETRO instead.
  - useFocusEffect from expo-router is the canonical "refetch when
    this screen comes back into focus" hook. Use it for screens that
    need to see updates from sibling screens.

Suggested milestones (one commit each):
  1. Backend: PATCH /items/{id} + DELETE /items/{id} + GET /tags
     + their integration tests
  2. Frontend: refactor existing index.tsx to be cleaner, add tag
     filter via useLocalSearchParams() (so /?tag=foo deep-links)
  3. Frontend: /items/[id] detail screen
  4. Frontend: /items/[id]/edit screen
  5. Frontend: /add screen (refactor existing form if applicable),
     navigate to /items/[new-id] on success
  6. Frontend: /tags screen
  7. Playwright: multi-screen navigation test (home → detail → edit →
     submit → detail → back → home)

Definition of done:
  - just verify is green
  - I can deep-link directly to /items/<some-id> in a browser and land
    on the detail screen with that item loaded
  - I can navigate home → detail → edit → submit, and the home list
    reflects the edit when I navigate back
  - I can click a tag on /tags and land on / with the filter applied
  - The Playwright multi-screen test passes
  - No state management libraries were added (verify with `grep -r
    "redux\|zustand\|jotai\|recoil\|tanstack\|swr" apps/mobile/` —
    should return nothing)
  - No external UI libraries were added (verify with `grep -r
    "react-native-paper\|nativewind\|tamagui\|gluestack" apps/mobile/`
    — should return nothing)

Before reporting done, write a retrospective to RETRO.md at the repo
root (do NOT commit it — leave it untracked). Cover:

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
  7. **Specific to this experiment:** at what point (if any) did the
     no-state-management rule start to feel painful? Where would a
     state library actually help? What did you do instead?

Also maintain LOG.md as you work — append-only, one entry per
significant action. Format:

  ## <n> — <one-line action>
  **Why:** <reason>
  **Outcome:** <result, including failures>

Keep LOG.md append-only. Never rewrite previous entries. The log is
ground truth for what happened in what order.

Do NOT start `expo start` or any dev server — I'll test the UI manually
after you report done. You can run `bunx expo export --platform web` to
verify the bundle compiles.

Go.
```

## What "passing" looks like (success criteria for the maintainer)

### Hard gates (binary)

- `just verify` exits 0 with the new web tests included
- All 5 screens exist as files under `apps/mobile/app/`
- The Playwright multi-screen navigation test exists and passes
- Deep linking works: `curl -fsS http://localhost:4321/items/some-id` returns the page (not a 404)
- `grep -rE "(redux|zustand|jotai|recoil|tanstack|swr|mobx|valtio)" apps/mobile/` returns zero matches
- `grep -rE "(react-native-paper|nativewind|tamagui|gluestack)" apps/mobile/` returns zero matches

### Soft signals (judgment calls)

- Each screen file is small — under ~150 lines is healthy. If any screen approaches 300 lines, the agent is probably fighting the no-state-mgmt rule with verbose workarounds.
- `useFocusEffect` is used wherever a screen needs to see updates from sibling screens.
- Form state is local to its screen, not lifted to a context.
- The `lib/api.ts` module gains the new endpoints cleanly — same `fetchItems` / `createItem` / `updateItem` / `deleteItem` shape, no leaking auth or session state.
- Tag filter is implemented via `useLocalSearchParams()` for deep-linking, not via local state alone.
- Navigation back through the chain feels native — no broken back stack.

### Skeleton-improvement signals (what to look for)

- **The "where do I put a hook" question.** If the agent introduces a custom hook (e.g., `useItems()`), where does it live? `apps/mobile/lib/hooks/`? Inside the screen file? CLAUDE.md doesn't currently say.
- **The "shared form state" question.** The Edit screen likely has a form. Is it managed locally? Via a custom hook? Worth codifying.
- **Did `useFocusEffect` get reached for naturally?** Or did the agent invent something else first?
- **The Playwright multi-screen test setup.** How did the agent structure it? Did they invent helper functions? Are they generic enough to promote into a `tests/web/_helpers.ts`?
- **The /tags → /?tag=foo deep link.** This requires a specific pattern (`router.push({ pathname: '/', params: { tag } })`). Did the agent figure it out, or get stuck?

### Things that would justify promoting to baseline

- A tested `useApiResource(fetcher)` pattern → consider whether to ship it as a starter helper (probably not — it's exactly the "abstraction for hypothetical reuse" CLAUDE.md warns against — but worth noting)
- A clean Playwright multi-step test pattern → document in `docs/testing.md` § "Web tier"
- A useful expo-router idiom (deep linking, params) → document in `docs/architecture.md` § Frontend

### Things that would justify a skeleton fix

- "Local useState + refetch IS painful at this scale, here's where" — if the RETRO surfaces specific cases where the rule is hostile, that's evidence to revisit the rule. The skeleton's "no state management library" stance is opinionated; this experiment is the test of whether the opinion holds.
- "I had to fight expo-router's typing" — typed routes have known issues, may need a docs note.
- "useFocusEffect doesn't cover case X" — non-obvious patterns worth documenting.

## Findings (to be filled in after the run)

> **Run on:** _date_  
> **Agent:** _Claude version_  
> **Final commit:** _sha_  
> **Verify status:** _green / red / partial_  
> **Skeleton bugs surfaced:** _list_  
> **Promotable patterns:** _list_  
> **Status:** _⏳ / 🟡 / ✅ / 🟠 / ❌_
