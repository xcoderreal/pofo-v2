# Pinned Versions (Expo SDK 54)

Last updated: 2026-04-10

## Core

| Package | Version | Notes |
|---|---|---|
| `expo` | `~54` | SDK 54 stable |
| `react-native` | `0.81.5` | |
| `react` | `19.1.0` | root override |
| `react-dom` | `19.1.0` | root override |

## Expo Packages

| Package | Version | Notes |
|---|---|---|
| `@expo/metro-runtime` | `~6.1.2` | Required for RN 0.81.x. 4.0.1 causes "getDevServer is not a function" on iOS |
| `expo-router` | `~6.0.23` | |
| `expo-status-bar` | `~3.0.9` | |
| `babel-preset-expo` | `~54.0.10` | Handles reanimated plugin automatically |

## React Native Packages

| Package | Version | Notes |
|---|---|---|
| `react-native-reanimated` | `4.1.1` | Exact pin. 4.1.6+ pulls worklets 0.7.x which mismatches Expo Go |
| `react-native-worklets` | `0.5.1` | Matches Expo Go SDK 54 native binary |
| `react-native-gesture-handler` | `~2.28.0` | |
| `react-native-safe-area-context` | `~5.6.0` | |
| `react-native-screens` | `~4.16.0` | |
| `react-native-svg` | `15.12.1` | |
| `react-native-web` | `^0.21.0` | |

## Dev Dependencies

| Package | Version | Notes |
|---|---|---|
| `@types/react` | `~19.1.10` | |
| `typescript` | `~5.9.2` | |

## Root Overrides (package.json)

```json
"overrides": {
  "react": "19.1.0",
  "react-dom": "19.1.0",
  "@expo/metro-runtime": "~6.1.2"
}
```

## Rules

- Do NOT add `react-native-reanimated/plugin` to babel.config.js — `babel-preset-expo` handles it automatically. The old plugin causes "TypeError: property is not writable" on iOS.
- When upgrading to SDK 55, remove the root overrides for react/react-dom.
- Use `npx expo install <pkg>` for native/Expo packages — it resolves SDK-compatible versions, then uses bun under the hood. `bun add` is fine for pure-JS packages.
- Use `npx expo export`, not `bunx --bun expo export` — Metro doesn't exit cleanly with bun's node replacement.
- Vercel builds require Node.js 22.x (not 24.x).
