# Big-wheel survey

Surveyed 2026-04-11. Simple restaurant picker app — the skeleton was extracted from this repo.

## What it is
Expo + FastAPI monorepo. Wheel-spin restaurant picker with distance-based sorting, tag filtering. YAML persistence.

## Backend (the template)
Cosmic Python hexagonal: `domain/` (model.py, repository ABC) → `service/` (RestaurantService, pure Haversine math) → `adapters/` (YamlRestaurantRepository) → `entrypoints/` (FastAPI routes). FakeRepository for tests, `Depends()` DI. This IS the skeleton's backend pattern.

## Frontend (the cautionary tale)
337-line monolithic `index.tsx` — all state, filters, wheel, render in one file. No component extraction, no custom hooks, no `components/` or `hooks/` directories. No frontend tests. `lib/api.ts` has a good env-aware URL resolver (localhost/LAN/Vercel).

## Best patterns
- Hexagonal backend layering (already extracted to skeleton)
- FakeRepository testing (already extracted)
- Env-aware API URL resolution in `lib/api.ts`
- Pydantic settings with prefix (`BW_*`)

## Antipatterns
- God component (337 lines, violates SRP)
- No frontend tests
- No error handling on fetches
- YAML persistence with no concurrency protection
- No type safety on API client (no validation of response shape)

## Verdict
Backend: gold standard (it IS the skeleton). Frontend: don't copy. The 337-line component is exactly what the skeleton's "Adding a new screen" guide + component extraction rules should prevent.
