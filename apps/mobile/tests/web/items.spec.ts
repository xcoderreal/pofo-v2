import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

async function resetState(page: Page) {
  // Delete all transactions first (depends on accounts/instruments)
  const txnsResp = await page.request.get(`${API}/transactions`);
  const txns = await txnsResp.json();
  for (const txn of txns) {
    await page.request.delete(`${API}/transactions/${txn.id}`);
  }
  // Delete all accounts
  const acctsResp = await page.request.get(`${API}/accounts`);
  const accts = await acctsResp.json();
  for (const acct of accts) {
    await page.request.delete(`${API}/accounts/${acct.id}`);
  }
  // Delete all instruments
  const instsResp = await page.request.get(`${API}/instruments`);
  const insts = await instsResp.json();
  for (const inst of insts) {
    await page.request.delete(`${API}/instruments/${inst.id}`);
  }
}

async function seed(page: Page) {
  await page.request.post(`${API}/accounts`, {
    data: { id: "schwab", name: "Schwab Brokerage", account_type: "brokerage" },
  });
  await page.request.post(`${API}/instruments`, {
    data: { id: "aapl", ticker: "AAPL", name: "Apple Inc." },
  });
  await page.request.post(`${API}/transactions`, {
    data: {
      id: "buy1",
      account_id: "schwab",
      instrument_id: "aapl",
      type: "buy",
      quantity: 10,
      price: 100,
      date: "2024-01-15",
    },
  });
}

test.beforeEach(async ({ page }) => {
  await resetState(page);
});

test("dashboard shows portfolio overview after seeding", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("portfolio-header")).toHaveText(
    "Portfolio Overview",
  );
  await expect(page.getByTestId("position-table")).toBeVisible();
});

test("dashboard shows empty state without data", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("no-positions")).toBeVisible();
  await expect(page.getByTestId("no-gains")).toBeVisible();
});

test("create account via accounts page", async ({ page }) => {
  await page.goto("/accounts");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("empty-accounts")).toBeVisible();

  await page.getByTestId("input-account-name").fill("Test Brokerage");
  await page.getByTestId("type-brokerage").click();
  await page.getByTestId("submit-account").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Test Brokerage")).toBeVisible();
});

test("create instrument via instruments page", async ({ page }) => {
  await page.goto("/instruments");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("empty-instruments")).toBeVisible();

  await page.getByTestId("input-ticker").fill("MSFT");
  await page.getByTestId("input-instrument-name").fill("Microsoft Corp");
  await page.getByTestId("submit-instrument").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("MSFT")).toBeVisible();
  await expect(page.getByText("Microsoft Corp")).toBeVisible();
});

test("log buy trade and see position on dashboard", async ({ page }) => {
  // Seed account + instrument first
  await page.request.post(`${API}/accounts`, {
    data: { id: "fidelity", name: "Fidelity IRA", account_type: "brokerage" },
  });
  await page.request.post(`${API}/instruments`, {
    data: { id: "googl", ticker: "GOOGL", name: "Alphabet Inc." },
  });

  // Navigate to new trade form
  await page.goto("/transactions/new");
  await page.waitForLoadState("networkidle");

  // Fill in the form
  await page.getByTestId("type-buy").click();
  await page.getByTestId("select-account-fidelity").click();
  await page.getByTestId("select-instrument-googl").click();
  await page.getByTestId("input-quantity").fill("5");
  await page.getByTestId("input-price").fill("2800");
  await page.getByTestId("input-date").fill("2024-03-01");
  await page.getByTestId("submit-transaction").click();

  // Should navigate back to dashboard
  await page.waitForLoadState("networkidle");

  // Go to dashboard and verify position appears
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("position-table")).toBeVisible();
});

test("drill down into account detail", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Click on the Schwab account card
  await page.getByTestId("account-card-schwab").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("detail-title")).toContainText("Schwab");
  await expect(page.getByTestId("portfolio-detail")).toBeVisible();
});

test("drill down into instrument detail", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Click on the AAPL instrument card
  await page.getByTestId("instrument-card-aapl").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("portfolio-detail")).toBeVisible();
});

test("view capital gains after sell", async ({ page }) => {
  await seed(page);

  // Add a sell transaction
  await page.request.post(`${API}/transactions`, {
    data: {
      id: "sell1",
      account_id: "schwab",
      instrument_id: "aapl",
      type: "sell",
      quantity: 5,
      price: 150,
      date: "2024-06-01",
    },
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Gains should now be visible
  await expect(page.getByTestId("gains-summary")).toBeVisible();
  await expect(page.getByTestId("total-realized-gain")).toBeVisible();
});
