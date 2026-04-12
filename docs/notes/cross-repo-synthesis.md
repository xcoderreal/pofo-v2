# Cross-repo synthesis: what to adopt

Surveyed 2026-04-11 across big-wheel, tripest, pitch-lab, personality-os. Goal: extract the best, avoid overfitting, assemble consistent guidance for AI-driven development with testability and maintainability.

## The comparison matrix

| Axis | big-wheel | tripest | pitch-lab | personality-os |
|---|---|---|---|---|
| **Complexity** | Simple (1 entity) | High (multi-entity, multi-provider) | High (complex domain math) | Medium (animations, no backend) |
| **Server state** | raw useState | TanStack Query v5 | Jotai (manual fetch) | none (offline) |
| **UI state** | raw useState | Jotai | Jotai | Jotai + atomWithStorage |
| **Data fetching** | fetch in useEffect | useQuery hooks | manual client calls | none |
| **Frontend tests** | zero | vitest + jest + Storybook | vitest (5 files, atoms + lib) | zero |
| **Backend tests** | unit + integration (FakeRepo) | unit + contract + integration | unit + integration (56 files) | none |
| **Backend DI** | ABC + Depends | Protocol + Depends | services (no ABC) | none |
| **Docs quality** | minimal | gold standard (zero divergence) | strong (CODING_CONVENTIONS as law) | good (ANIMATIONS.md) |
| **OpenAPI codegen** | no | yes (hey-api SDK) | yes (openapi-typescript) | no |

## Feature / capability matrix

| Capability | big-wheel | tripest | pitch-lab | personality-os | pofo |
|---|---|---|---|---|---|
| **CRUD (basic)** | yes (restaurants) | yes (trips, bookings) | yes (scores, spans) | no backend | yes (accounts, instruments, transactions) |
| **Multi-entity domain** | 1 entity | ★ 5+ entities, FK relationships | 6+ domain types (spans, chords, keys, notes) | 1 (personality profile) | ★ 6 entities, cross-entity math |
| **Complex business logic** | Haversine distance | ★ scheduling, transit routing, dedup+rank | ★ harmony suggestion, chord realization, FIFO voicing | quiz scoring | ★ capital gains (FIFO lot matching), double-entry ledger |
| **Auth** | none | ★ Supabase Auth (OAuth, JWT) | none | none | multi-tenant (demo users) |
| **Persistence** | YAML file | ★ Supabase (Postgres) | SQLite (file-based) | AsyncStorage (offline) | SQLite + SQLModel + Alembic |
| **External API integration** | none | ★ Google Maps Directions, Yelp Fusion, NAVITIME (3 providers, async, dedup+rank) — **paid APIs, $$ per call** | none | none | yfinance (free, no auth) |
| **Real-time / live data** | none | none | none | none | live stock prices |
| **Gestures** | wheel spin (basic) | reorderable lists (drag) | ★ chord boundary drag (Pan), piano roll taps | none | none |
| **Animations** | wheel spin | minimal | Skia piano roll rendering, note fade | ★ heavy (floating orbs, stagger, cylinder wrap, glow) | none |
| **Audio** | none | none | ★ Web Audio API + expo-audio fallback, dual engine | none | none |
| **Maps / location** | none | ★ planned (Google Directions, MapKit/MapView for iOS) | none | none | none |
| **Native packages (complexity)** | minimal (Expo managed) | moderate (Supabase SDK, maps planned, CNG) | ★ heavy (react-native-skia, react-native-audio-api, expo-haptics, dev build required) | moderate (reanimated, gesture-handler) | minimal (Expo managed) |
| **Offline support** | none | none | none | ★ full (AsyncStorage + atomWithStorage) | none |
| **Canvas / custom rendering** | none | none | ★ react-native-skia (piano roll) | none | Recharts (portfolio charts) |
| **Charts / data viz** | none | none | none | radar chart (WealthRadar) | ★ Recharts (positions, capital gains, portfolio) |
| **Multi-step forms** | none | ★ trip creation wizard | intent builder (multi-step) | onboarding flow | add-transaction wizard (account→instrument→qty) |
| **Undo / redo** | none | none | ★ Jotai atom stack | none | none |
| **Deep linking** | none | ★ trip share links | score/[id] | none | none |
| **MCP integration** | none | none | none | none | ★ full (tools + resources for Claude) |
| **Cross-platform** | web + mobile (Expo) | ★ web (Next.js) + mobile (Expo) | mobile only (iOS) | mobile only | web (Next.js) only |
| **OpenAPI codegen** | none | ★ hey-api SDK | openapi-typescript | none | none |
| **Haptics** | none | none | ★ expo-haptics | none | none |
| **Push notifications** | none | planned | none | none | none |

★ = most complex / most mature implementation of that capability across all repos.

### What this tells us about pofo v2

Pofo v2 will exercise a **unique combination** that no single repo has tested:
- Multi-entity domain with cross-entity math (capital gains, FIFO) — closest to pitch-lab's complexity
- External API adapter (yfinance) — closest to tripest's provider pattern
- Charts / data viz (Recharts) — new axis, only personality-os had radar charts
- Multi-step forms (transaction wizard) — tripest + pitch-lab both have these
- MCP integration — completely novel, no repo has this
- Auth + multi-tenant — only tripest has this

The skeleton needs to support all of these without prescribing the domain. The cross-repo patterns (TanStack Query, hooks/, lib/, component extraction) should be generic enough to accommodate them.

## Decisions (with reasoning)

### 1. State management: TanStack Query + Jotai

**Adopt from:** tripest (primary), pitch-lab (Jotai patterns)

**The split:**
- **TanStack Query** = server state (data from API). Handles caching, deduplication, refetch on focus, loading/error states, cache invalidation after mutations. Replaces `useFocusEffect` + `useState` + manual loading/error booleans.
- **Jotai** = UI-only ephemeral state (selection, editor mode, form inputs, animation toggles). Add only when a screen needs state that doesn't come from the server.

**Why not Jotai for everything (pitch-lab's approach)?** Pitch-lab uses Jotai for server state AND UI state. This works but means: no automatic refetch, no cache deduplication, no loading/error states, manual cache invalidation. Tripest's approach gets all of this for free.

**Why not raw useState (big-wheel's approach)?** Works for 1-3 screens. Falls apart at 5+ when screens need shared data or when you want loading/error handling without boilerplate.

**Why Jotai over Zustand/Redux?** Jotai is atomic (bottom-up), not store-based (top-down). Each atom is independent — no single store to reason about, no selectors, no reducers. Atoms compose naturally with React's rendering model. Fits the skeleton's "minimal abstraction" philosophy.

### 2. Data fetching: custom hooks wrapping useQuery

**Adopt from:** tripest

**The pattern:**
```
lib/api.ts          → raw fetch functions (fetchItems, createItem)
hooks/useItems.ts   → useQuery({ queryKey: ["items"], queryFn: fetchItems })
app/index.tsx       → const { data, isLoading, error } = useItems()
```

**Rules:**
- Screens call hooks. Hooks call `useQuery`/`useMutation` with functions from `lib/api.ts`. Screens never import from `lib/api.ts` directly.
- One hook file per resource (`useItems.ts`, `usePositions.ts`, `useTransactions.ts`).
- Mutations use `useMutation` + `onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] })`.
- Loading/error states handled uniformly: hooks return `{ data, isLoading, error }`.

**Why this layering?** Testability. `lib/api.ts` is pure (test with bun test). Hooks are testable with QueryClientProvider mocking. Screens are thin wrappers.

### 3. Frontend file organization

**Adopt from:** pitch-lab (component folders) + tripest (hooks/ + lib/ separation)

```
app/            — expo-router pages (thin: call hooks, render components)
components/     — shared UI, extract when 2+ screens use same component
  ComponentName/  — folder when >300 lines: index.tsx + types.ts + sub-components
hooks/          — useQuery/useMutation wrappers per resource
lib/            — pure logic (api.ts, formatting, calculations). ZERO React imports.
tests/
  unit/         — bun test on lib/ and hooks/
  web/          — Playwright specs
```

**Rules:**
- **Pages are thin.** `app/index.tsx` calls `useItems()`, handles loading/error, renders `<ItemList items={data} />`. No business logic, no direct fetches.
- **Extract components at 2+ screens**, not before. Three similar lines beats a premature `<SharedCard>`.
- **Component folders when >300 lines.** `ComponentName/index.tsx` (orchestrator) + `types.ts` + sub-components. Sub-components form a strict DAG: import from `types.ts` only, never cross-import.
- **`lib/` has zero React imports.** Everything here is testable with `bun test`. If it needs `useX`, it's a hook, not a lib.
- **`hooks/` = data hooks.** One file per resource: `useItems.ts`, `useAuth.ts`. UI-only hooks (useDebounce, useKeyboard) live here too.
- **No `atoms/` directory by default.** Add Jotai atoms only when a screen needs UI state that doesn't come from the server. When you do, one file per concern (e.g., `atoms/editor.ts`).

### 4. Testing (frontend)

**Adopt from:** tripest (contract tests, coverage gates) + pitch-lab (extract to lib, test lib)

**The hierarchy:**
1. **`lib/` pure functions** — tested via `bun test`. Formatting, calculations, validation, API types. This is the floor.
2. **`hooks/` data hooks** — tested via vitest/jest with `QueryClientProvider` wrapper. Verify cache invalidation, loading states.
3. **Playwright web tier** — happy-path specs per screen (existing skeleton pattern). `testID` for stable selectors. `workers: 1` + `beforeEach(resetAndSeed)`.
4. **No component render tests by default.** Visual review is sufficient until the app has 10+ shared components. Then consider Storybook.

**From tripest:** contract tests for fakes. When frontend fakes exist (e.g., FakeItemService for Storybook), verify they conform to the interface structurally.

### 5. Backend patterns (confirmed, minor additions)

**Already in skeleton:** Cosmic Python hexagonal, ABC + FakeRepository, lifespan + app.state, OpenAPI codegen.

**Adopt from tripest:**
- **Error handling per layer:** adapters catch provider-specific errors → domain exception. Services raise domain exceptions. Entrypoints map to HTTP status codes. Document this.
- **None discipline:** required fields MUST NOT have defaults. Resolve absence at ONE boundary, pass non-nullable downstream.
- **Semantic type aliases:** `NewType("OwnerId", str)`, `NewType("ItemId", str)` prevent accidental type confusion in service signatures with multiple string params. Add when 2+ string params exist.

**From pitch-lab:**
- **Frozen domain models.** The skeleton uses `@dataclass`; pitch-lab uses frozen Pydantic. For the skeleton, `@dataclass(frozen=True)` achieves the same thing without Pydantic in domain. Consider adopting.
- **Backend owns domain computation.** Frontend is presentation only. Never re-derive in TypeScript what the backend already computed.

**NOT adopting from tripest:**
- **typing.Protocol instead of ABC.** Both work. The skeleton already uses ABC consistently and it's validated across 4 experiments. Switching adds churn for no functional gain.
- **Async everywhere.** The skeleton uses sync FastAPI handlers (simpler, threadpool-safe). Async is the right choice at tripest's scale but premature for the skeleton's target complexity.

### 6. Animation patterns (if needed)

**Adopt from:** personality-os (conventions), pitch-lab (gesture patterns)

- **Reanimated v4 only** — don't mix with React Native Animated API
- **Spring config as a constant** — `SPRING_CONFIG = {damping: 22, stiffness: 200, mass: 0.8}` in one file
- **Staggered entrance hook** — reusable `useStaggerFade` for list/page entrances
- **Animation values separate from business state** — animated components never read from Jotai atoms directly; pass data as props, animate in the component
- **Document animation patterns** — personality-os's ANIMATIONS.md is the template

**NOT adopting:** gesture logic in components. Extract gesture handlers to hooks. Pitch-lab's `resizeBoundary` pure function (gesture logic as pure fn, component just applies result) is the right pattern.

---

## What NOT to adopt (antipatterns observed across repos)

| Antipattern | Where seen | Why skip |
|---|---|---|
| Jotai for server state | pitch-lab | TanStack Query does this better (caching, dedup, loading/error) |
| Raw useState + useEffect for fetching | big-wheel | No caching, no error handling, no loading states |
| No frontend tests | big-wheel, personality-os | Every repo without tests has bugs we can't see |
| God components (>300 lines, all-in-one) | big-wheel (337-line index.tsx) | Extract components + hooks |
| Frontend re-implementing backend logic | pitch-lab (music-theory.ts) | Backend owns computation, frontend displays results |
| Mixed animation APIs | personality-os | Pick one (Reanimated v4) |
| Gesture logic inline in components | pitch-lab | Extract to hooks or pure functions |
| Manual API type definitions | big-wheel | OpenAPI codegen (already in skeleton) |
| Prop drilling beyond 2 levels | pitch-lab (identified in their own ARCHITECTURE_EVOLUTION.md) | Use hooks or Jotai atoms |

---

## Implementation priority for the skeleton

**Must-have (before pofo v2):**
1. TanStack Query + QueryClientProvider + example `useItems` hook
2. `hooks/` directory convention in docs
3. Component extraction rule (>300 lines → folder)
4. `lib/` = zero React imports rule
5. Pages-are-thin rule documented

**Nice-to-have (can land during pofo v2):**
6. Jotai + atoms/ directory (when UI-only state appears)
7. Error handling per layer documented (backend)
8. None discipline documented (backend)
9. Theme centralization (`utils/theme.ts`)
10. Animation conventions (if pofo v2 needs animation)
