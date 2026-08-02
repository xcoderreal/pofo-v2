import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

const IRA = "demo-dev-user-ira";
const RESERVE = "demo-dev-user-reserve";

/** Every metric the query interface offers, with the header it produces.
 * The whole closed enum, because "all seven are reachable" is the first
 * acceptance criterion. */
const METRICS: [key: string, header: string][] = [
  ["equity", "EQUITY VALUE"],
  ["unrealized_gain", "UNREALIZED GAIN"],
  ["cost_basis", "COST BASIS"],
  ["share_count", "SHARE COUNT"],
  ["market_price", "MARKET PRICE"],
  ["realized_gain", "REALIZED GAIN · BOOKED IN RANGE"],
  ["cash_balance", "CASH BALANCE · WHOLE PORTFOLIO"],
];

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
}

async function pickMetric(page: Page, metric: string) {
  await page.getByTestId("metric-button").click();
  await expect(page.getByTestId("metric-sheet")).toBeVisible();
  await page.getByTestId(`metric-sheet-option-${metric}`).click();
  await expect(page.getByTestId("metric-sheet")).toHaveCount(0);
}

/** `YYYY-MM-DD`, `offset` days before today — so the Custom range spec
 * doesn't expire the way a hardcoded date would. */
function daysAgo(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("every metric is reachable, and the header and headline follow it", async ({
  page,
}) => {
  await openDashboard(page);

  for (const [metric, header] of METRICS) {
    // share_count and market_price need an instrument, and cash_balance
    // drops the one we have — so re-drill whenever the chip is gone.
    if ((await page.getByTestId("chip-instrument").count()) === 0) {
      await expect(page.getByTestId("positions-loading")).toBeHidden();
      await page.getByTestId("holding-row-goog").click();
      await expect(page.getByTestId("chip-instrument")).toBeVisible();
    }

    await pickMetric(page, metric);

    await expect(page.getByTestId("metric-label")).toHaveText(header);
    // The chart is a real query per metric: a mode or scope the API
    // rejects surfaces here rather than as a silently stale number.
    await expect(page.getByTestId("chart-error")).toHaveCount(0);
    await expect(page.getByTestId("big-value")).toBeVisible();
    await expect(page.getByTestId("portfolio-chart")).toBeVisible();
  }

  // A share count is not money, and a price keeps its cents.
  await page.getByTestId("holding-row-goog").click();
  await pickMetric(page, "share_count");
  await expect(page.getByTestId("big-value")).toHaveText("205");

  await pickMetric(page, "market_price");
  await expect(page.getByTestId("big-value")).toHaveText(/^\$[\d,]+\.\d{2}$/);
});

test("share count and market price are disabled, with the reason inline", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("metric-button").click();

  for (const metric of ["share_count", "market_price"]) {
    await expect(page.getByTestId(`metric-sheet-note-${metric}`)).toHaveText(
      "One instrument only — pick an instrument first",
    );
  }

  // Disabled means disabled: the row stays on screen and explains itself,
  // and tapping it changes nothing.
  await page.getByTestId("metric-sheet-option-market_price").click();
  await expect(page.getByTestId("metric-sheet")).toBeVisible();
  await page.getByTestId("metric-sheet-scrim").click();
  await expect(page.getByTestId("metric-label")).toHaveText(
    "EQUITY VALUE · WHOLE PORTFOLIO",
  );

  // With an instrument in scope the reason is gone and the row works.
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId("metric-button").click();
  await expect(page.getByTestId("metric-sheet-note-share_count")).toHaveText(
    "One instrument only",
  );
  await page.getByTestId("metric-sheet-option-share_count").click();
  await expect(page.getByTestId("metric-label")).toHaveText("SHARE COUNT");
});

test("market price clears the Account chip, and Undo puts the slice back", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId(`breakdown-row-${IRA}`).click();
  await expect(page.getByTestId("chip-account")).toContainText("Wells Fargo IRA");

  // The row warns before the tap, then the tap does exactly that.
  await page.getByTestId("metric-button").click();
  await expect(page.getByTestId("metric-sheet-note-market_price")).toHaveText(
    "One instrument only — clears the account filter",
  );
  await page.getByTestId("metric-sheet-option-market_price").click();

  // Asserted first — the offer is only up for five seconds.
  await expect(page.getByTestId("undo-toast-message")).toHaveText(
    "Account filter removed — market price has no account dimension",
  );
  await expect(page.getByTestId("chip-account")).toHaveCount(0);
  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("metric-label")).toHaveText("MARKET PRICE");
  await expect(page.getByTestId("chart-error")).toHaveCount(0);

  await page.getByTestId("undo-toast-action").click();

  await expect(page.getByTestId("chip-account")).toContainText("Wells Fargo IRA");
  await expect(page.getByTestId("metric-label")).toHaveText("EQUITY VALUE");
});

test("cash balance clears the Instrument chip, and Undo puts the slice back", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId(`breakdown-row-${IRA}`).click();

  await page.getByTestId("metric-button").click();
  await expect(page.getByTestId("metric-sheet-note-cash_balance")).toHaveText(
    "Uninvested cash — clears the instrument filter",
  );
  await page.getByTestId("metric-sheet-option-cash_balance").click();

  await expect(page.getByTestId("undo-toast-message")).toHaveText(
    "Instrument filter removed — cash balance has no instrument dimension",
  );
  await expect(page.getByTestId("chip-instrument")).toHaveCount(0);
  await expect(page.getByTestId("chip-account")).toContainText("Wells Fargo IRA");
  await expect(page.getByTestId("metric-label")).toHaveText("CASH BALANCE");
  await expect(page.getByTestId("chart-error")).toHaveCount(0);

  await page.getByTestId("undo-toast-action").click();

  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("metric-label")).toHaveText("EQUITY VALUE");
});

test("the Granularity sheet shows the current bucket and refuses ones the span can't fill", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("range-1W").click();
  await expect(page.getByTestId("granularity-chip")).toContainText("Daily");

  await page.getByTestId("granularity-chip").click();
  await expect(page.getByTestId("granularity-sheet")).toBeVisible();
  // A week has one selectable bucket, and the other three say why not.
  await expect(
    page.getByTestId("granularity-sheet-selected-daily"),
  ).toBeVisible();
  await expect(page.getByTestId("granularity-sheet-note-daily")).toHaveText(
    "Default for this range",
  );
  for (const granularity of ["weekly", "monthly", "yearly"]) {
    await expect(
      page.getByTestId(`granularity-sheet-note-${granularity}`),
    ).toHaveText("Too coarse for the selected range");
  }

  await page.getByTestId("granularity-sheet-option-monthly").click();
  await expect(page.getByTestId("granularity-sheet")).toBeVisible();
  await page.getByTestId("granularity-sheet-scrim").click();
  await expect(page.getByTestId("granularity-chip")).toContainText("Daily");

  // A year can fill all four, and the override sticks.
  await page.getByTestId("range-1Y").click();
  await page.getByTestId("granularity-chip").click();
  await page.getByTestId("granularity-sheet-option-weekly").click();
  await expect(page.getByTestId("granularity-sheet")).toHaveCount(0);
  await expect(page.getByTestId("granularity-chip")).toContainText("Weekly");
});

test("the Accounts sheet picks an account and gets back to the whole portfolio", async ({
  page,
}) => {
  await openDashboard(page);

  await page.getByTestId("all-accounts-chip").click();
  await expect(page.getByTestId("accounts-sheet")).toBeVisible();
  await expect(
    page.getByTestId("accounts-sheet-selected-__all__"),
  ).toBeVisible();

  await page.getByTestId(`accounts-sheet-option-${RESERVE}`).click();
  await expect(page.getByTestId("chip-account")).toContainText("Cash Reserve");
  // The seed's Cash Reserve holds no instruments, so the metric follows.
  await expect(page.getByTestId("metric-label")).toHaveText("CASH BALANCE");

  // The chip is also the control: its body reopens the sheet.
  await page.getByTestId("chip-account-open").click();
  await expect(
    page.getByTestId(`accounts-sheet-selected-${RESERVE}`),
  ).toBeVisible();
  await page.getByTestId("accounts-sheet-option-__all__").click();

  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("chip-account")).toHaveCount(0);
  await expect(page.getByTestId("all-accounts-chip")).toBeVisible();
});

test("the Accounts sheet disables accounts that never held the instrument", async ({
  page,
}) => {
  // AC 18.6: an option you cannot usefully pick stays on screen and says
  // why. Picking Cash Reserve while GOOG is in scope builds a slice with
  // no holding row, no closed row and a chart with no points.
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");

  await page.getByTestId("all-accounts-chip").click();
  await expect(page.getByTestId("accounts-sheet")).toBeVisible();

  // The seed holds GOOG in the brokerage and the IRA, never in the
  // cash-only reserve.
  await expect(page.getByTestId(`accounts-sheet-note-${IRA}`)).not.toHaveText(
    "Never held GOOG",
  );
  await expect(page.getByTestId(`accounts-sheet-note-${RESERVE}`)).toHaveText(
    "Never held GOOG",
  );

  // Disabled means disabled: tapping it leaves the sheet open and the
  // scope untouched.
  await page.getByTestId(`accounts-sheet-option-${RESERVE}`).click();
  await expect(page.getByTestId("accounts-sheet")).toBeVisible();
  await expect(page.getByTestId("chip-account")).toHaveCount(0);

  // And the enabled one still works.
  await page.getByTestId(`accounts-sheet-option-${IRA}`).click();
  await expect(page.getByTestId("chip-account")).toContainText("IRA");
});

test("with no instrument in scope every account stays selectable", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("all-accounts-chip").click();

  for (const account of [IRA, RESERVE]) {
    await expect(
      page.getByTestId(`accounts-sheet-note-${account}`),
    ).not.toContainText("Never held");
  }
});

test("the Custom pill opens a date-range sheet and applies the bounds", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("range-Custom").click();
  await expect(page.getByTestId("custom-sheet")).toBeVisible();

  // Nothing typed yet, so there is nothing to apply.
  await expect(page.getByTestId("custom-status")).toHaveText(
    "Enter both dates as YYYY-MM-DD",
  );
  await page.getByTestId("custom-apply").click();
  await expect(page.getByTestId("custom-sheet")).toBeVisible();

  // A reversed range is refused, with the reason, rather than silently
  // producing an empty chart.
  await page.getByTestId("custom-start").fill(daysAgo(0));
  await page.getByTestId("custom-end").fill(daysAgo(90));
  await expect(page.getByTestId("custom-status")).toHaveText(
    "The start date must come first",
  );

  await page.getByTestId("custom-start").fill(daysAgo(90));
  await page.getByTestId("custom-end").fill(daysAgo(0));
  await page.getByTestId("custom-apply").click();

  await expect(page.getByTestId("custom-sheet")).toHaveCount(0);
  await expect(page.getByTestId("range-label")).toHaveText("custom range");
  // Granularity re-derives from the resolved span, not the range's name:
  // 91 days is a weekly chart.
  await expect(page.getByTestId("granularity-chip")).toContainText("Weekly");
  await expect(page.getByTestId("chart-error")).toHaveCount(0);
  await expect(page.getByTestId("big-value")).toBeVisible();
});
