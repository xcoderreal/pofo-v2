import Constants from "expo-constants";
import { Platform } from "react-native";

declare const process: { env: Record<string, string | undefined> };

const API_PORT = 8090;

/**
 * Resolves the backend API base URL at runtime.
 *
 * Precedence:
 *   1. EXPO_PUBLIC_API_URL — explicit build-time override (any platform)
 *   2. Native (iOS/Android) — reuse Metro's dev server host from expo-constants
 *      so physical devices on the same LAN reach the backend without config
 *   3. Web — derive from window.location (localhost / LAN / Vercel prod)
 *   4. Fallback — localhost
 *
 * Exported for unit testing; prefer importing BASE_URL from lib/api.ts in app code.
 */
export function resolveApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  if (Platform.OS === "ios" || Platform.OS === "android") {
    return resolveNativeBaseUrl();
  }

  if (Platform.OS === "web" && typeof window !== "undefined") {
    return resolveWebBaseUrl(window.location);
  }

  return `http://localhost:${API_PORT}`;
}

function resolveNativeBaseUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}:${API_PORT}`;
  }
  // Simulator fallbacks: iOS sim shares the host network; Android emulator
  // reaches the host via the 10.0.2.2 NAT alias.
  return Platform.OS === "android"
    ? `http://10.0.2.2:${API_PORT}`
    : `http://localhost:${API_PORT}`;
}

function resolveWebBaseUrl(location: Location): string {
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
