import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8090";

// Instruments has no DELETE endpoint (not needed by its ticket), so tests
// can't reset the shared in-memory repo between runs like other web specs
// do — instead each test uses a symbol unique to that test run, matching
// the same pattern the backend's own e2e tests use for this resource.
function uniqueSymbol(label: string): string {
  return `${label}${Date.now()}`.slice(0, 10).toUpperCase();
}

test("home screen shows a seeded instrument", async ({ page }) => {
  const symbol = uniqueSymbol("SEED");
  await page.request.post(`${API}/instruments`, {
    data: { id: symbol.toLowerCase(), symbol, name: "Seeded Co", asset_class: "equity" },
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const card = page.getByTestId(`instrument-card-${symbol.toLowerCase()}`);
  await expect(card).toBeVisible();
  await expect(
    page.getByTestId(`instrument-symbol-${symbol.toLowerCase()}`),
  ).toHaveText(symbol);
});

test("create instrument via form", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const symbol = uniqueSymbol("NEW");
  await page.getByTestId("input-symbol").fill(symbol);
  await page.getByTestId("input-name").fill("Playwright Test Co");
  await page.getByTestId("asset-class-option-etf").click();
  await page.getByTestId("submit-instrument").click();

  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Playwright Test Co")).toBeVisible();
});

test("duplicate symbol shows an error", async ({ page }) => {
  const symbol = uniqueSymbol("DUP");
  await page.request.post(`${API}/instruments`, {
    data: { id: symbol.toLowerCase(), symbol, name: "Original", asset_class: "equity" },
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("input-symbol").fill(symbol);
  await page.getByTestId("input-name").fill("Duplicate");
  await page.getByTestId("submit-instrument").click();

  await expect(page.getByTestId("create-instrument-error")).toBeVisible();
});
