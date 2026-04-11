import { describe, expect, test } from "bun:test";

import { resolveApiBaseUrlFromEnv } from "../../../lib/env-core";

/**
 * Unit tests for the pure URL resolver.
 *
 * The resolver is designed to be trivially testable: `resolveApiBaseUrlFromEnv`
 * takes an environment shape as a parameter, so we never need to mock
 * `react-native` / `expo-constants` / `window.location`. Each test constructs
 * a fixture env and asserts the resulting URL.
 *
 * If you need to test the adapter (`resolveApiBaseUrl`), that requires module
 * mocking — but it's a thin pass-through, so covering the pure function is
 * usually enough.
 */

describe("resolveApiBaseUrlFromEnv — explicit override", () => {
  test("envUrl takes precedence over everything else", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
        envUrl: "https://staging.example.com/api",
        location: { hostname: "localhost", protocol: "http:" },
      }),
    ).toBe("https://staging.example.com/api");
  });

  test("envUrl works on native too", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "ios",
        envUrl: "https://staging.example.com/api",
        hostUri: "192.168.1.42:8081",
      }),
    ).toBe("https://staging.example.com/api");
  });
});

describe("resolveApiBaseUrlFromEnv — native (iOS/Android)", () => {
  test("iOS physical device uses Metro's LAN hostUri", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "ios",
        hostUri: "192.168.1.42:8081",
      }),
    ).toBe("http://192.168.1.42:8090");
  });

  test("iOS simulator falls back to localhost when hostUri is localhost", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "ios",
        hostUri: "localhost:8081",
      }),
    ).toBe("http://localhost:8090");
  });

  test("iOS simulator falls back to localhost when hostUri is missing", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "ios",
      }),
    ).toBe("http://localhost:8090");
  });

  test("Android physical device uses Metro's LAN hostUri", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "android",
        hostUri: "192.168.1.42:8081",
      }),
    ).toBe("http://192.168.1.42:8090");
  });

  test("Android emulator falls back to 10.0.2.2 when hostUri is localhost", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "android",
        hostUri: "localhost:8081",
      }),
    ).toBe("http://10.0.2.2:8090");
  });

  test("Android emulator falls back to 10.0.2.2 when hostUri is missing", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "android",
      }),
    ).toBe("http://10.0.2.2:8090");
  });

  test("native rejects 127.0.0.1 as hostUri (treats as loopback)", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "ios",
        hostUri: "127.0.0.1:8081",
      }),
    ).toBe("http://localhost:8090");
  });
});

describe("resolveApiBaseUrlFromEnv — web", () => {
  test("web localhost uses localhost:8090", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
        location: { hostname: "localhost", protocol: "http:" },
      }),
    ).toBe("http://localhost:8090");
  });

  test("web 127.0.0.1 uses localhost:8090", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
        location: { hostname: "127.0.0.1", protocol: "http:" },
      }),
    ).toBe("http://localhost:8090");
  });

  test("web LAN 192.168.x.y uses same-host:8090", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
        location: { hostname: "192.168.1.42", protocol: "http:" },
      }),
    ).toBe("http://192.168.1.42:8090");
  });

  test("web LAN 10.x.x.x uses same-host:8090", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
        location: { hostname: "10.0.0.5", protocol: "http:" },
      }),
    ).toBe("http://10.0.0.5:8090");
  });

  test("web Vercel prod uses same-origin /api", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
        location: { hostname: "myapp.vercel.app", protocol: "https:" },
      }),
    ).toBe("/api");
  });

  test("web without location returns localhost fallback", () => {
    expect(
      resolveApiBaseUrlFromEnv({
        platform: "web",
      }),
    ).toBe("http://localhost:8090");
  });
});

describe("resolveApiBaseUrlFromEnv — misc platforms", () => {
  test("desktop platforms (windows/macos) return localhost fallback", () => {
    expect(resolveApiBaseUrlFromEnv({ platform: "macos" })).toBe(
      "http://localhost:8090",
    );
    expect(resolveApiBaseUrlFromEnv({ platform: "windows" })).toBe(
      "http://localhost:8090",
    );
  });
});
