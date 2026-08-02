import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

/**
 * The one Flow metric, end to end (#19).
 *
 * The seed books exactly one sell — 90 TSLA at $288 against a $250 cost,
 * 300 days ago — so every figure here is arithmetic on fixture constants
 * rather than on a fetched price. That is the point: realized gain is the
 * one metric a price-source outage cannot move, so an exact assertion is
 * safe where the equity headline can only be matched by shape.
 */
const REALIZED_TOTAL = "+$3,420.00";

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
}

async function pickMetric(page: Page, metric: string) {
  await page.getByTestId("metric-button").click();
  await expect(page.getByTestId("metric-sheet")).toBeVisible();
  await page.getByTestId(`metric-sheet-option-${metric}`).click();
  await expect(page.getByTestId("metric-sheet")).toHaveCount(0);
}

const bars = (page: Page) =>
  page.locator('[data-testid^="portfolio-chart-bar-"]');

test("realized gain draws bars around a zero baseline, and levels stay lines", async ({
  page,
}) => {
  await openDashboard(page);

  // Equity is a Level: a line, and no bars anywhere.
  await expect(page.getByTestId("portfolio-chart")).toBeVisible();
  await expect(bars(page)).toHaveCount(0);

  await pickMetric(page, "realized_gain");

  await expect(page.getByTestId("chart-error")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-chart")).toBeVisible();
  const barCount = await bars(page).count();
  expect(barCount).toBeGreaterThan(0);

  // Every bar stands on the same baseline and stays inside the plot —
  // which is what "around a zero baseline" means geometrically, and what
  // breaks first if the y-domain stops including zero.
  const chart = await page.getByTestId("portfolio-chart").boundingBox();
  expect(chart).not.toBeNull();
  const baselines = new Set<number>();
  for (let i = 0; i < barCount; i++) {
    const box = await bars(page).nth(i).boundingBox();
    expect(box).not.toBeNull();
    if (box === null || chart === null) continue;
    expect(box.height).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThanOrEqual(chart.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(chart.y + chart.height + 1);
    baselines.add(Math.round(box.y + box.height));
  }
  // The seed books one gain and it is positive, so every bar grows up
  // from the baseline and they all end on it.
  expect(baselines.size).toBe(1);

  // Back to a Level and the bars are gone again.
  await pickMetric(page, "equity");
  await expect(bars(page)).toHaveCount(0);
});

test("the Per period / Cumulative toggle switches modes without changing the total", async ({
  page,
}) => {
  await openDashboard(page);

  // The toggle belongs to the Flow metric, so it isn't there yet.
  await expect(page.getByTestId("mode-toggle")).toHaveCount(0);

  await pickMetric(page, "realized_gain");

  await expect(page.getByTestId("mode-toggle")).toBeVisible();
  // Per period is the default: a Flow's natural reading is what each
  // bucket booked, and the running total is the derived view of it.
  await expect(page.getByTestId("mode-selected-per-period")).toBeVisible();

  // The headline is the total booked across the visible range, and the
  // sub-line counts buckets rather than quoting a percentage against the
  // first one.
  await expect(page.getByTestId("big-value")).toHaveText(REALIZED_TOTAL);
  await expect(page.getByTestId("delta")).toHaveText(
    /^\d+ (day|week|month|year) buckets?$/,
  );
  await expect(page.getByTestId("range-label")).toHaveText("past year");
  const perPeriodBuckets = await page.getByTestId("delta").textContent();

  await page.getByTestId("mode-cumulative").click();

  await expect(page.getByTestId("mode-selected-cumulative")).toBeVisible();
  await expect(page.getByTestId("mode-selected-per-period")).toHaveCount(0);
  // A real second query — a mode the API rejected would surface here.
  await expect(page.getByTestId("chart-error")).toHaveCount(0);
  await expect(bars(page).first()).toBeVisible();

  // Same gains, described two ways: the running total's last bucket is
  // the sum of the per-period ones, so the headline must not move. The
  // bucket count may, because `cumulative` carries the total forward
  // through periods that booked nothing.
  await expect(page.getByTestId("big-value")).toHaveText(REALIZED_TOTAL);
  await expect(page.getByTestId("delta")).toHaveText(
    /^\d+ (day|week|month|year) buckets?$/,
  );
  expect(await page.getByTestId("delta").textContent()).not.toBe(
    perPeriodBuckets,
  );

  await page.getByTestId("mode-per-period").click();
  await expect(page.getByTestId("delta")).toHaveText(perPeriodBuckets ?? "");

  // Leaving the Flow metric takes the toggle with it.
  await pickMetric(page, "cost_basis");
  await expect(page.getByTestId("mode-toggle")).toHaveCount(0);
});

test("a range that booked nothing is an empty chart, not an error", async ({
  page,
}) => {
  await openDashboard(page);
  await pickMetric(page, "realized_gain");

  // Year-to-date is the window #26 will default this metric to, and on
  // most days of the year the seed's single sell falls outside it. Either
  // way the screen holds: a Flow with no bookings has a total of zero, not
  // a failed query.
  for (const range of ["YTD", "1W", "Max"]) {
    await page.getByTestId(`range-${range}`).click();
    await expect(page.getByTestId("chart-error")).toHaveCount(0);
    await expect(page.getByTestId("big-value")).toBeVisible();
    await expect(page.getByTestId("delta")).toHaveText(
      /^\d+ (day|week|month|year) buckets?$/,
    );
  }
});

test("the toggle arriving does not reflow the control row", async ({ page }) => {
  await openDashboard(page);

  // The slot is reserved from the start (#14), so the pills and the
  // granularity chip must not move when realized gain fills it.
  const before = await page.getByTestId("granularity-chip").boundingBox();
  const slotBefore = await page.getByTestId("mode-slot").boundingBox();

  await pickMetric(page, "realized_gain");
  await expect(page.getByTestId("mode-toggle")).toBeVisible();

  const after = await page.getByTestId("granularity-chip").boundingBox();
  const slotAfter = await page.getByTestId("mode-slot").boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after?.x).toBeCloseTo(before?.x ?? -1, 1);
  expect(after?.y).toBeCloseTo(before?.y ?? -1, 1);
  expect(slotAfter?.x).toBeCloseTo(slotBefore?.x ?? -1, 1);
  expect(slotAfter?.width).toBeCloseTo(slotBefore?.width ?? -1, 1);
});
