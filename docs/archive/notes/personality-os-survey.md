# Personality-os survey

Surveyed 2026-04-11. MBTI personality quiz app with heavy animations.

## What it is
Expo app (no backend, fully offline). MBTI type profiles, wealth radar charts, animated onboarding. AsyncStorage persistence via Jotai atoms.

## Animation patterns (the strength)
Three systems coexist (a problem, but patterns are instructive):
1. **Reanimated v4** — MirrorHero (spring + SVG clipping), welcome (floating orbs, staggered fade)
2. **React Native Animated API** — explore grid with cylinder-wrap (3-phase: exit → teleport → enter)
3. **Static components** — business logic separated from animation entirely

Key conventions:
- `SPRING_CONFIG = {damping: 22, stiffness: 200, mass: 0.8}` — defined once, reused everywhere
- `useStaggerFade` — reusable staggered entrance hook (delay + opacity + translateY)
- `ANIMATE_MELD` toggle — animations optional, not required for UX

## State management
Jotai with `atomWithStorage` for persistence. Computed atoms for derived state. Clean separation: business atoms never touch animation values.

## File organization
`app/` (expo-router) + `components/` (reusable UI) + `atoms/` (Jotai state) + `content/` (YAML + codegen) + `utils/` (theme.ts, scoring.ts)

## Best patterns
- Theme centralization (`utils/theme.ts` — colors, spacing, fontSize, borderRadius)
- Spring config as constant (standardizes feel across app)
- YAML → TypeScript codegen pipeline (zero runtime parsing)
- Separated business state from animation state
- Staggered entrance hook (reusable)
- ANIMATIONS.md documentation (rare and excellent)

## Antipatterns
- **Zero tests** — nothing. Not unit, not integration, not e2e.
- Mixed animation APIs (Reanimated + Animated in same codebase, no migration plan)
- 600-line explore screen with animation logic inline
- SVG animation bridging (Reanimated → runOnJS → SVG props) is fragile

## Docs
ANIMATIONS.md — explains Gray Code grid, cylinder wrap, 3-phase animation, performance. CLAUDE.md — project conventions. UX_PRINCIPLES.md — progressive disclosure, breathing room.

## Verdict
Animation patterns are instructive but untestable. Theme centralization + spring constants + staggered entrance hook are extractable. Zero tests disqualifies most patterns from being "best practice."
