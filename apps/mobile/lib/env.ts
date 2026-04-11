import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  API_PORT,
  type ResolveEnv,
  resolveApiBaseUrlFromEnv,
} from "./env-core";

declare const process: { env: Record<string, string | undefined> };

// Re-export the pure API for convenience (app code can import either
// here or from env-core directly).
export { API_PORT, type ResolveEnv, resolveApiBaseUrlFromEnv };

/**
 * Adapter that reads the actual runtime environment (Platform,
 * expo-constants, process.env, window.location) and delegates to the
 * pure function in `env-core.ts`. This is what app code imports via
 * `lib/api.ts`.
 *
 * For unit tests, import `resolveApiBaseUrlFromEnv` from `./env-core`
 * directly — that file has no framework imports and tests cleanly
 * under `bun test`.
 */
export function resolveApiBaseUrl(): string {
  return resolveApiBaseUrlFromEnv({
    platform: Platform.OS as ResolveEnv["platform"],
    hostUri: Constants.expoConfig?.hostUri ?? undefined,
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    location:
      typeof window !== "undefined"
        ? {
            hostname: window.location.hostname,
            protocol: window.location.protocol,
          }
        : undefined,
  });
}
