/**
 * Pure URL resolution logic — no react-native, no expo-constants, no globals.
 *
 * This file exists separately from `lib/env.ts` so that unit tests can
 * import the pure function without pulling in `react-native`'s Flow-typed
 * entry file (which bun test's Babel front-end can't parse). The adapter
 * that reads actual globals lives in `lib/env.ts` and re-exports everything
 * here for production use.
 *
 * If you're writing app code, import from `lib/api.ts` (or `lib/env.ts`);
 * if you're writing unit tests for URL resolution, import from here.
 */

export const API_PORT = 8090;

export interface ResolveEnv {
  platform: "ios" | "android" | "web" | "windows" | "macos";
  /** Metro dev server host from `Constants.expoConfig?.hostUri` (native only) */
  hostUri?: string;
  /** Explicit override via EXPO_PUBLIC_API_URL */
  envUrl?: string;
  /** `window.location` for web; undefined for native or SSR */
  location?: { hostname: string; protocol: string };
}

/**
 * Pure function that maps an environment shape to a backend base URL.
 *
 * Precedence:
 *   1. envUrl — explicit build-time override (any platform)
 *   2. Native (iOS/Android) — reuse Metro's dev server host so physical
 *      devices on the same LAN reach the backend without config
 *   3. Web — derive from `location` (localhost / LAN / Vercel prod)
 *   4. Fallback — localhost
 */
export function resolveApiBaseUrlFromEnv(env: ResolveEnv): string {
  if (env.envUrl) {
    return env.envUrl;
  }

  if (env.platform === "ios" || env.platform === "android") {
    return resolveNativeBaseUrl(env.platform, env.hostUri);
  }

  if (env.platform === "web" && env.location) {
    return resolveWebBaseUrl(env.location);
  }

  return `http://localhost:${API_PORT}`;
}

function resolveNativeBaseUrl(
  platform: "ios" | "android",
  hostUri: string | undefined,
): string {
  const host = hostUri?.split(":")[0];
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}:${API_PORT}`;
  }
  // Simulator / emulator fallbacks when Metro advertises `localhost` as
  // hostUri: iOS sim shares the host network directly; Android emulator
  // (AVD) reaches the host via its 10.0.2.2 NAT alias. Physical devices
  // always land in the branch above because QR scanning requires Metro
  // to advertise a LAN-reachable URL.
  return platform === "android"
    ? `http://10.0.2.2:${API_PORT}`
    : `http://localhost:${API_PORT}`;
}

function resolveWebBaseUrl(location: { hostname: string; protocol: string }): string {
  const { hostname, protocol } = location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://localhost:${API_PORT}`;
  }
  // LAN dev: same host, API on configured port
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
    return `${protocol}//${hostname}:${API_PORT}`;
  }
  // Production (Vercel): same-origin, API at /api
  return "/api";
}
