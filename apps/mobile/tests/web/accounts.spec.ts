import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8090";

// Accounts has no DELETE endpoint, so — same pattern as instruments.spec.ts —
// each test uses a name unique to that test run instead of resetting the
// shared in-memory repo between tests.
function uniqueName(label: string): string {
  return `${label} ${Date.now()}`;
}

test("navigate from instruments to accounts", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("nav-accounts").click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("create-account-form")).toBeVisible();
});

test("accounts screen shows a seeded account", async ({ page }) => {
  const name = uniqueName("Seeded Brokerage");
  const create = await page.request.post(`${API}/accounts`, {
    data: {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      institution: "Test Bank",
      account_type: "brokerage",
    },
  });
  const created = await create.json();

  await page.goto("/accounts");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId(`account-card-${created.id}`)).toBeVisible();
  await expect(page.getByTestId(`account-name-${created.id}`)).toHaveText(name);
});

test("create account via form", async ({ page }) => {
  await page.goto("/accounts");
  await page.waitForLoadState("networkidle");

  const name = uniqueName("New Account");
  await page.getByTestId("input-account-name").fill(name);
  await page.getByTestId("input-account-institution").fill("Playwright Bank");
  await page.getByTestId("account-type-option-ira").click();
  await page.getByTestId("submit-account").click();

  await page.waitForLoadState("networkidle");
  await expect(page.getByText(name)).toBeVisible();
});
