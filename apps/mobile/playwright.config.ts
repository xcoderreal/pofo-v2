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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : "list",
  timeout: 30_000,

  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
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
