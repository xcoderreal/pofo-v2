import { expect, test } from "@playwright/test";

/**
 * The floor for runtime UI validation: load the home screen in a real
 * browser and assert nothing explodes.
 *
 * This tier exists because tsc + bundle build pass cleanly even when the
 * code crashes at render time (e.g. React Native Web style-shim errors
 * that are invisible to the type checker). Any uncaught pageerror or
 * console.error fails the test.
 *
 * Keep this smoke test small. Add more detailed interaction tests as
 * sibling files if you want coverage beyond "loads without errors."
 */
test("home screen loads without runtime errors", async ({ page }) => {
  const errors: string[] = [];

  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  await page.goto("/");

  // Wait for the bundle to boot and any async hydration to settle.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  // A title has been set (rules out a completely blank page).
  await expect(page).toHaveTitle(/.+/);

  // The critical assertion: nothing threw during render.
  expect(
    errors,
    `runtime errors during page load:\n  ${errors.join("\n  ")}`,
  ).toEqual([]);
});
