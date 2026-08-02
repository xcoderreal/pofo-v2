import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the web test tier (`tests/web/`).
 *
 * Runs the exported Expo web bundle in headless Chromium. Catches runtime
 * UI errors that tsc + bundle build miss — CSS crashes, hydration failures,
 * uncaught exceptions during render.
 *
 * The `webServer` block exports the bundle and serves it statically so
 * tests run against the same artifact that ships to production.
 */
export default defineConfig({
  testDir: "./tests/web",
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : "list",
  timeout: 30_000,

  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "on-first-retry",
  },

  /**
   * Two projects, split by whether the tests write.
   *
   * The backend is one process with a singleton in-memory repository for
   * the whole run, and there is no purge endpoint yet (that is #29) — so a
   * spec that records a Transaction permanently changes the row counts and
   * totals the read-only specs assert exactly ("Accounts · 4", "20
   * transactions", the Grid's matrix). `dependencies` makes "reads first,
   * then writes" a declared fact rather than an alphabetical accident of
   * the filenames.
   *
   * `writes` still keeps its own blast radius small: it records into
   * accounts it creates itself, so its assertions never depend on what a
   * previous run left behind.
   */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /transaction-entry\.spec\.ts/,
    },
    {
      name: "chromium-writes",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /transaction-entry\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],

  webServer: [
    // Backend — the Expo bundle fetches from it on mount, so the test
    // needs a real server to avoid net::ERR_CONNECTION_REFUSED errors
    // polluting the page-load assertion.
    {
      command:
        "cd ../api && uv run uvicorn myapp.entrypoints.api:app --host 127.0.0.1 --port 8090",
      url: "http://127.0.0.1:8090/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // Explicit — a developer's local .env.local (e.g. MYAPP_AUTH=supabase,
      // set for manual testing per docs/environments.md) would otherwise
      // silently break every web test's seed requests with 401s. Real env
      // vars outrank .env/.env.local in pydantic-settings' precedence.
      env: { MYAPP_AUTH: "stub" },
    },
    // Frontend — export the web bundle and serve dist/ on a fixed port.
    // `npx expo export` (not bunx) because Metro doesn't exit cleanly under bun.
    {
      command: "npx expo export --platform web && bunx serve dist -l 4321 -s",
      url: "http://127.0.0.1:4321",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
