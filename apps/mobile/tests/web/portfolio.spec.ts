import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8090";

// The dashboard renders whatever the seeded demo portfolio contains, so
// every test here first makes sure seeding has happened. It's idempotent
// server-side, so calling it per test is safe and keeps tests independent
// of each other's ordering.
test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

test("portfolio screen renders the equity chart and headline value", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("metric-label")).toBeVisible();
  await expect(page.getByTestId("big-value")).toBeVisible();
  await expect(page.getByTestId("portfolio-chart")).toBeVisible();

  // A real figure computed from seeded transactions and fetched prices
  // — not a placeholder, and not the $0 that a total price-fetch
  // failure would silently produce.
  await expect(page.getByTestId("big-value")).toHaveText(/\$[\d,]*[1-9][\d,]*/);
});

test("range pills are all present and selectable", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  for (const key of ["1W", "1M", "3M", "6M", "YTD", "1Y", "Max"]) {
    await expect(page.getByTestId(`range-${key}`)).toBeVisible();
  }
});

test("changing the range updates the range label", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("range-label")).toHaveText("past year");

  await page.getByTestId("range-1M").click();
  await expect(page.getByTestId("range-label")).toHaveText("past month");

  await page.getByTestId("range-Max").click();
  await expect(page.getByTestId("range-label")).toHaveText("all time");
});

test("Max spans the whole history, not a single day", async ({ page }) => {
  // The bug this guards against: the screen resolved Max with no earliest
  // transaction date, so it collapsed to `start = end = today` — one
  // point, "+$0.00  +0.00%", Daily granularity, under a label still
  // reading "all time". The test above only ever asserted that label,
  // which is exactly why this shipped broken. So: assert the *request*.
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const charted = page.waitForRequest(
    (request) =>
      request.url().includes("/portfolio/query") &&
      request.url().includes("group_by=none"),
  );
  await page.getByTestId("range-Max").click();
  const params = new URL((await charted).url()).searchParams;

  const start = params.get("start");
  const end = params.get("end");
  expect(start).not.toBeNull();
  expect(end).not.toBe(start);
  // The demo seed's first deposit is 730 days back, so anything under a
  // year means the earliest-transaction date never arrived.
  const spanDays =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
    86_400_000;
  expect(spanDays).toBeGreaterThan(365);

  await expect(page.getByTestId("range-label")).toHaveText("all time");
  // Daily is what a one-day span auto-selects; a two-year span is monthly.
  await expect(page.getByTestId("granularity-chip")).toContainText("Monthly");
  await expect(page.getByTestId("delta")).not.toHaveText("+$0.00  +0.00%");
});

test("granularity follows the selected range's span", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // The chip carries a disclosure caret alongside the label (#18 made it
  // the Granularity sheet's trigger), so this reads the label, not the
  // whole node.
  await page.getByTestId("range-1W").click();
  await expect(page.getByTestId("granularity-chip")).toContainText("Daily");

  await page.getByTestId("range-1Y").click();
  await expect(page.getByTestId("granularity-chip")).toContainText("Monthly");
});

test("the mode slot is reserved so the control row does not reflow", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Present from the start, before realized gain (#19) fills it.
  await expect(page.getByTestId("mode-slot")).toBeAttached();
});

test("bottom navigation reaches all three destinations", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-screen")).toBeVisible();

  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-screen")).toBeVisible();

  await page.getByTestId("nav-portfolio").click();
  await expect(page.getByTestId("portfolio-screen")).toBeVisible();
});
