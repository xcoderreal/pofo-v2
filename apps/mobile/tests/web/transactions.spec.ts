import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8090";

// No DELETE endpoint on any of these resources — same pattern as the
// other web specs in this repo — so each test seeds its own uniquely
// named account/instrument rather than resetting shared state.
async function seedAccountAndInstrument(
  request: import("@playwright/test").APIRequestContext,
) {
  const suffix = `${Date.now()}`;
  const accountId = `tx-acc-${suffix}`;
  const accountResp = await request.post(`${API}/accounts`, {
    data: {
      id: accountId,
      name: `TX Test Brokerage ${suffix}`,
      institution: "Test Bank",
      account_type: "brokerage",
    },
  });
  const account = await accountResp.json();

  // Last digits of the timestamp, not the first — the leading digits of
  // Date.now() barely change across a whole test run, so slicing from the
  // front risks two tests colliding on the same symbol (409, seen as a
  // real flake here).
  const symbol = `TX${suffix.slice(-8)}`;
  const instrumentId = `tx-i-${suffix}`;
  const instrumentResp = await request.post(`${API}/instruments`, {
    data: {
      id: instrumentId,
      symbol,
      name: `TX Test Instrument ${suffix}`,
      asset_class: "equity",
    },
  });
  const instrument = await instrumentResp.json();

  return { account, instrument };
}

test("log a buy and see the position update", async ({ page, request }) => {
  const { account, instrument } = await seedAccountAndInstrument(request);

  // A buy now debits cash automatically — fund the account first. Must be
  // timezone-aware (like the form's own new Date().toISOString()) — FIFO
  // sorts this deposit alongside the trade's own timestamp, and Python
  // can't compare a naive datetime against an aware one.
  await request.post(`${API}/transactions/deposit`, {
    data: {
      account_id: account.id,
      amount: "10000",
      timestamp: "2025-12-31T00:00:00Z",
    },
  });

  await page.goto("/transactions");
  await page.waitForLoadState("networkidle");

  await page.getByTestId(`account-option-${account.id}`).click();
  await page.getByTestId(`instrument-option-${instrument.id}`).click();
  await page.getByTestId("transaction-type-option-buy").click();
  await page.getByTestId("input-quantity").fill("10");
  await page.getByTestId("input-price").fill("150");
  await page.getByTestId("submit-transaction").click();

  await expect(page.getByTestId("position-share-count")).toHaveText("Shares: 10");
  await expect(page.getByTestId("position-cost-basis")).toHaveText(
    "Cost basis: 1500",
  );
});

test("selling more than held shows an error", async ({ page, request }) => {
  const { account, instrument } = await seedAccountAndInstrument(request);

  await page.goto("/transactions");
  await page.waitForLoadState("networkidle");

  await page.getByTestId(`account-option-${account.id}`).click();
  await page.getByTestId(`instrument-option-${instrument.id}`).click();
  await page.getByTestId("transaction-type-option-sell").click();
  await page.getByTestId("input-quantity").fill("5");
  await page.getByTestId("input-price").fill("200");
  await page.getByTestId("submit-transaction").click();

  await expect(page.getByTestId("create-transaction-error")).toBeVisible();
});

test("navigate from accounts to transactions", async ({ page }) => {
  await page.goto("/accounts");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("nav-transactions").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("log-transaction-form")).toBeVisible();
});
