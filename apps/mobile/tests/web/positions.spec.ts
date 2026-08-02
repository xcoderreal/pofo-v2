import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8090";

// Everything below reads the seeded demo portfolio, which is idempotent
// server-side — safe to call per test, and keeps tests independent of
// each other's ordering.
test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openDashboard(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
}

test("holdings tab lists one row per held instrument", async ({ page }) => {
  await openDashboard(page);

  // The seed holds GOOG and VOO in two accounts each — one row apiece,
  // pivoted client-side from the batched positions endpoint.
  for (const id of ["goog", "voo", "vti", "aapl", "btc"]) {
    await expect(page.getByTestId(`holding-row-${id}`)).toBeVisible();
  }
});

test("the CASH instrument never appears as a holdings row", async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByTestId("holding-row-cash")).toHaveCount(0);
});

test("tab labels carry their row counts", async ({ page }) => {
  await openDashboard(page);

  // Five live holdings (TSLA is closed and lives under the disclosure),
  // four accounts.
  await expect(page.getByTestId("tab-holdings")).toHaveText("Holdings · 5");
  await expect(page.getByTestId("tab-accounts")).toHaveText("Accounts · 4");
});

test("closed positions are collapsed away from the live list", async ({ page }) => {
  await openDashboard(page);

  // TSLA was opened and fully closed by the seed — it must not be mixed
  // into the live rows.
  await expect(page.getByTestId("holding-row-tsla")).toHaveCount(0);
  await expect(page.getByTestId("closed-toggle")).toHaveText(/Closed positions · 1/);
  await expect(page.getByTestId("closed-row-tsla")).toHaveCount(0);

  await page.getByTestId("closed-toggle").click();

  await expect(page.getByTestId("closed-row-tsla")).toBeVisible();
  // (288.00 - 250.00) * 90 shares.
  await expect(page.getByTestId("closed-realized-tsla")).toHaveText(
    "realized +$3,420.00",
  );
});

test("accounts tab lists every account, valued including cash", async ({ page }) => {
  await openDashboard(page);
  await page.getByTestId("tab-accounts").click();

  for (const slug of ["brokerage", "ira", "coinbase", "reserve"]) {
    await expect(
      page.getByTestId(`account-row-demo-dev-user-${slug}`),
    ).toBeVisible();
  }

  // The cash-only account holds no instruments at all, so its whole value
  // is cash: 48000 + 9000 deposited, 4000 withdrawn.
  await expect(
    page.getByTestId("account-value-demo-dev-user-reserve"),
  ).toHaveText("$53,000");
});

test("row percentages are range-scoped and the dash case is real", async ({
  page,
}) => {
  await openDashboard(page);

  // AAPL was bought 200 days ago, so over the past year it did not exist
  // at the range start — no denominator, a dash. GOOG (650 days ago) did,
  // so it gets a real figure over the same range.
  await expect(page.getByTestId("holding-percent-aapl")).toHaveText("—");
  await expect(page.getByTestId("holding-percent-goog")).toHaveText(/^[+−]\d/);

  // Narrow the range to inside AAPL's lifetime and the same row gains a
  // percentage — the list re-fetches with the range exactly as the header
  // figure does.
  await page.getByTestId("range-3M").click();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
  await expect(page.getByTestId("holding-percent-aapl")).toHaveText(/^[+−]\d/);
});

test("switching tabs swaps the list without losing the chart", async ({ page }) => {
  await openDashboard(page);

  await page.getByTestId("tab-accounts").click();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
  await expect(page.getByTestId("account-row-demo-dev-user-ira")).toBeVisible();
  await expect(page.getByTestId("holding-row-goog")).toHaveCount(0);

  await page.getByTestId("tab-holdings").click();
  await expect(page.getByTestId("holding-row-goog")).toBeVisible();
  await expect(page.getByTestId("big-value")).toBeVisible();
});
