# Pitch-lab survey

Surveyed 2026-04-11 (code + docs). Music composition tool — chord editor, piano roll, harmony suggestion.

## What it is
Expo (mobile-focused, iOS) + FastAPI backend. Complex domain: harmonic timelines, chord structures, scales, voicings, note generation. Gesture-based chord boundary editing, Skia-based piano roll.

## Backend (strong domain modeling)
- **Frozen Pydantic domain models** with operator overloads — `Rational.__add__`, `Pitch.__eq__`, `Key.scale_pitch_classes()`. Immutable by default (`ConfigDict(frozen=True)`).
- Services: HarmonyService, GenerationService, RealizationService, NotationEditService
- Clean layering: `domain/` (primitives, harmony, score, structure) → `services/` → `api/` (FastAPI routes)
- Backend **owns all domain computation** — frontend never re-derives chord structures or scale degrees
- 56 test files, pytest, real domain logic (no mocking)

## Frontend architecture
- **Jotai for everything** (8 atom files) — server state AND UI state. No TanStack Query.
- Manual `client.POST/GET/DELETE` calls with error handling via Alert.alert
- Discriminated union spans (Chord | Hole | NC) — type-safe with TypeScript type guards
- Pure function state mutations: `resizeBoundary(spans[], leftId, rightId, newBeat) → newSpans[]`
- Edit history as Jotai atom stack (undo/redo without a library)
- Component folder pattern: `ComponentName/index.tsx + types.ts + sub-components` when >300 lines

## File organization
```
app/         — expo-router routes
components/  — reusable UI (PianoRoll/, ChordEditor/, TransportBar)
atoms/       — Jotai state (8 files: harmony, selection, editor, intent, key-context, edit-history, score, editor-settings)
hooks/       — custom hooks (usePlayback, useHaptics, useNoteActions)
lib/         — pure logic (music-theory.ts, chord-display.ts, api.ts)
```

## OpenAPI codegen
FastAPI → openapi.json → openapi-typescript → @pitch-lab/contracts → openapi-fetch. Same pattern as skeleton's `gen-api-types`.

## Docs (strong)
- **CODING_CONVENTIONS.md** — 9 conventions, treated as law. TODOs point to convention violations with reasoning.
- Three-tier naming: backend canonical (`HarmonicSpan`), `Api` prefix for generated (`ApiHarmonicSpan`), purpose-based frontend (`TimelineHarmonicSpan`)
- Component >300 lines → folder with sub-components (strict DAG: sub-components import from `types.ts` only)
- ARCHITECTURE_EVOLUTION.md — honest about current bottlenecks (prop drilling, stale snapshots)

## Best patterns
1. **Frozen domain primitives with operator overloads** — readable math, no mutation bugs
2. **Pure function state mutations** — testable, no side effects, previewable
3. **Edit history as atom stack** — undo/redo without a library
4. **Discriminated unions** (Chord | Hole | NC) — vastly superior to optional fields
5. **Component folder pattern** when >300 lines — clean decomposition
6. **CODING_CONVENTIONS.md as law** — explicit, enforceable
7. **Backend owns domain computation** — frontend is presentation only
8. **OpenAPI codegen pipeline** — type-safe, single source of truth

## Antipatterns
1. **No TanStack Query** — manual fetch + Alert for errors, no caching, no loading/error states
2. **Frontend music theory duplication** — `lib/music-theory.ts` re-implements backend logic (documented as tech debt)
3. **Gesture logic in components** — ChordEditor's Gesture.Pan handler directly mutates shared values
4. **No retry/backoff** on network calls
5. **Prop drilling** identified as bottleneck (ARCHITECTURE_EVOLUTION.md)
6. **No gesture or component tests** — only atoms + pure functions tested

## Verdict
Strongest domain modeling of all repos. Frozen Pydantic + operator overloads, discriminated unions, pure function mutations, edit history stack — all extractable. Weakest on data fetching (manual, no TanStack Query) and gesture testability.
