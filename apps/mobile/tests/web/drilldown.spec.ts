import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

const BROKERAGE = "demo-dev-user-brokerage";
const IRA = "demo-dev-user-ira";
const RESERVE = "demo-dev-user-reserve";

// Everything below reads the seeded demo portfolio, which is idempotent
// server-side — safe to call per test, and keeps tests independent of
// each other's ordering.
test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
}

test("a Holdings row drills to instrument level, and one of its accounts to a slice", async ({
  page,
}) => {
  await openDashboard(page);

  // Portfolio -> instrument. GOOG is held in two accounts by the seed, so
  // "Across your accounts" has something to say.
  await page.getByTestId("holding-row-goog").click();

  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("section-title")).toHaveText(
    "Across your accounts",
  );
  await expect(page.getByTestId(`breakdown-row-${BROKERAGE}`)).toBeVisible();
  await expect(page.getByTestId(`breakdown-row-${IRA}`)).toBeVisible();
  // Tabs are a portfolio-level control: every narrower level has one list.
  await expect(page.getByTestId("tab-holdings")).toHaveCount(0);

  // Instrument -> slice.
  await page.getByTestId(`breakdown-row-${IRA}`).click();

  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("chip-account")).toContainText("Wells Fargo IRA");
  await expect(page.getByTestId("holding-row-goog")).toBeVisible();
  await expect(page.getByTestId("holding-row-voo")).toHaveCount(0);
});

test("instrument level shows the six-field stat card, and a slice does not", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();

  await expect(page.getByTestId("instrument-stat-card")).toBeVisible();
  // 60 + 25 bought in the brokerage, 120 in the IRA.
  await expect(page.getByTestId("stat-shares")).toHaveText("205");
  await expect(page.getByTestId("stat-market-price")).toHaveText(/^\$[\d,]+\.\d{2}$/);
  await expect(page.getByTestId("stat-avg-cost")).toHaveText(/^\$[\d,]+\.\d{2}$/);
  await expect(page.getByTestId("stat-unrealized")).toHaveText(/^[+−]\$/);
  // Never traded away, so nothing is booked.
  await expect(page.getByTestId("stat-realized")).toHaveText("+$0.00");
  await expect(page.getByTestId("stat-cost-basis")).toHaveText(/^\$[\d,]/);

  await page.getByTestId(`breakdown-row-${IRA}`).click();
  await expect(page.getByTestId("instrument-stat-card")).toHaveCount(0);
});

test("an Accounts row drills to account level, cash row first", async ({ page }) => {
  await openDashboard(page);
  await page.getByTestId("tab-accounts").click();
  await page.getByTestId(`account-row-${BROKERAGE}`).click();

  await expect(page.getByTestId("chip-account")).toContainText(
    "Wells Fargo Brokerage",
  );
  await expect(page.getByTestId("cash-row")).toBeVisible();
  await expect(page.getByTestId("holding-row-goog")).toBeVisible();
  // VTI is only ever bought in the IRA, so the account's list is genuinely
  // narrower rather than the whole portfolio with a chip on top.
  await expect(page.getByTestId("holding-row-vti")).toHaveCount(0);
});

test("dismissing a chip steps back one level and offers Undo for five seconds", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId(`breakdown-row-${IRA}`).click();

  await page.getByTestId("chip-account-clear").click();

  // Asserted first: the offer is only up for five seconds, so anything
  // slower checked before it would race the timer.
  await expect(page.getByTestId("undo-toast")).toBeVisible();

  // slice -> instrument, not slice -> portfolio.
  await expect(page.getByTestId("chip-account")).toHaveCount(0);
  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("instrument-stat-card")).toBeVisible();

  await expect(page.getByTestId("undo-toast")).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("Undo restores the whole view state, not just the chip", async ({ page }) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId(`breakdown-row-${IRA}`).click();
  await page.getByTestId("range-3M").click();
  await expect(page.getByTestId("range-label")).toHaveText("past 3 months");

  await page.getByTestId("chip-instrument-clear").click();
  await expect(page.getByTestId("undo-toast")).toBeVisible();

  // Move the range *after* the chip went away. If Undo only put the chip
  // back, the range would stay at 1W — the snapshot is the whole state.
  await page.getByTestId("range-1W").click();
  await expect(page.getByTestId("range-label")).toHaveText("past week");

  await page.getByTestId("undo-toast-action").click();

  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("chip-account")).toContainText("Wells Fargo IRA");
  await expect(page.getByTestId("range-label")).toHaveText("past 3 months");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);
});

test("an account with no instruments switches the metric to cash balance", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("tab-accounts").click();

  // The seed's Cash Reserve holds deposits and a withdrawal and nothing
  // else — equity there is a flat zero, so the metric follows the account.
  await page.getByTestId(`account-row-${RESERVE}`).click();
  await expect(page.getByTestId("metric-label")).toHaveText("CASH BALANCE");
  await expect(page.getByTestId("big-value")).toHaveText("$53,000");

  // Backing out leaves the metric where the auto-adjustment put it...
  await page.getByTestId("chip-account-clear").click();
  await expect(page.getByTestId("metric-label")).toHaveText(
    "CASH BALANCE · WHOLE PORTFOLIO",
  );

  // ...until an instrument is picked, which cash balance cannot answer.
  await expect(page.getByTestId("positions-loading")).toBeHidden();
  await page.getByTestId("holding-row-goog").click();
  await expect(page.getByTestId("metric-label")).toHaveText("EQUITY VALUE");
});

test("an account with no positions and no cash shows an empty state, not a blank chart", async ({
  page,
}) => {
  // Stubbed rather than created: account deletion doesn't exist until
  // #24, so a real extra account would leak into every later spec's
  // counts. The backend intersects an unknown account id away, so its
  // positions and series come back genuinely empty.
  await page.route("**/accounts", async (route) => {
    const response = await route.fetch();
    const accounts = await response.json();
    await route.fulfill({
      response,
      json: [
        ...accounts,
        {
          id: "phantom",
          name: "Fresh Account",
          institution: "Nowhere",
          account_type: "brokerage",
        },
      ],
    });
  });

  await openDashboard(page);
  await page.getByTestId("tab-accounts").click();
  await page.getByTestId("account-row-phantom").click();

  await expect(page.getByTestId("account-empty")).toBeVisible();
  await expect(page.getByTestId("account-empty")).toContainText(
    "first buy or deposit",
  );
  await expect(page.getByTestId("portfolio-chart")).toHaveCount(0);
  await expect(page.getByTestId("big-value")).toHaveCount(0);
});

test("the chart and headline follow the active scope", async ({ page }) => {
  await openDashboard(page);
  const wholePortfolio = await page.getByTestId("big-value").textContent();

  await page.getByTestId("holding-row-goog").click();
  await expect(page.getByTestId("instrument-stat-card")).toBeVisible();
  const instrumentValue = await page.getByTestId("big-value").textContent();

  // One instrument is worth less than everything, and the headline is the
  // same figure the stat card reports for it.
  expect(instrumentValue).not.toBe(wholePortfolio);
  await expect(page.getByTestId("portfolio-chart")).toBeVisible();

  await page.getByTestId(`breakdown-row-${IRA}`).click();
  await expect(page.getByTestId("chip-account")).toBeVisible();
  const sliceValue = await page.getByTestId("big-value").textContent();

  expect(sliceValue).not.toBe(instrumentValue);
});
