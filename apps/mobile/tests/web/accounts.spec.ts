import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

const BROKERAGE = "demo-dev-user-brokerage";

/**
 * Account creation and cascade delete (#24).
 *
 * **A writing spec**, so it runs in the `chromium-writes` project, which
 * depends on the read-only `chromium` one (`playwright.config.ts`). The
 * backend is one process with an in-memory repository and no purge
 * endpoint yet (#29), so anything created here would otherwise land in the
 * row counts the other specs assert exactly.
 *
 * Every account this file makes carries a run-unique name, and `afterEach`
 * deletes whatever survived — which is itself a use of the endpoint under
 * test, and the reason a local re-run (`reuseExistingServer`) doesn't
 * accumulate a longer and longer Accounts list.
 */

const PREFIX = "Acct Spec";
let seq = 0;

function uniqueName(): string {
  return `${PREFIX} ${Date.now().toString(36)}${seq++}`;
}

async function accountIdByName(page: Page, name: string): Promise<string> {
  const accounts = await (await page.request.get(`${API}/accounts`)).json();
  const match = accounts.find((a: { name: string }) => a.name === name);
  expect(match, `no account named ${name}`).toBeTruthy();
  return match.id;
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

test.afterEach(async ({ page }) => {
  const accounts = await (await page.request.get(`${API}/accounts`)).json();
  for (const account of accounts as { id: string; name: string }[]) {
    if (account.name.startsWith(PREFIX)) {
      await page.request.delete(`${API}/accounts/${account.id}`);
    }
  }
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
}

async function openGrid(page: Page) {
  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-total")).toBeVisible();
}

/** Fill the create form and submit it. */
async function fillNewAccount(
  page: Page,
  name: string,
  { institution = "Acct Spec Bank", type = "brokerage" } = {},
) {
  await expect(page.getByTestId("account-sheet")).toBeVisible();
  await page.getByTestId("account-input-name").fill(name);
  await page.getByTestId("account-input-institution").fill(institution);
  await page.getByTestId(`account-type-${type}`).click();
  await expect(page.getByTestId(`account-type-selected-${type}`)).toBeVisible();
  await page.getByTestId("account-submit").click();
  await expect(page.getByTestId("account-sheet")).toHaveCount(0);
}

/** An account with a real ledger behind it — a deposit, a buy, and the
 * buy's auto-posted CASH leg. */
async function fundedAccount(page: Page, name: string): Promise<string> {
  const id = `acct-spec-${Date.now().toString(36)}-${seq++}`;
  const created = await page.request.post(`${API}/accounts`, {
    data: {
      id,
      name,
      institution: "Acct Spec Bank",
      account_type: "brokerage",
    },
  });
  expect(created.status()).toBe(201);
  await page.request.post(`${API}/transactions/deposit`, {
    data: { account_id: id, amount: "5000", timestamp: "2026-01-01T00:00:00" },
  });
  const buy = await page.request.post(`${API}/transactions`, {
    data: {
      account_id: id,
      instrument_id: "goog",
      type: "buy",
      quantity: "2",
      price: "100",
      timestamp: "2026-01-05T00:00:00",
    },
  });
  expect(buy.status()).toBe(201);
  return id;
}

// ─── Creation ─────────────────────────────────────────────────

test("the Accounts sheet creates an account, and lands the view on it", async ({
  page,
}) => {
  // AC 2, first of the two required entry points.
  const name = uniqueName();
  await openDashboard(page);
  await page.getByTestId("all-accounts-chip").click();
  await page.getByTestId("accounts-sheet-option-__new__").click();

  await fillNewAccount(page, name, { type: "ira" });

  // Creating one from the "which account?" sheet is answering that
  // question, so the view goes there — and a brand-new account has nothing
  // in it, which is the empty state, not a broken screen.
  await expect(page.getByTestId("chip-account")).toContainText(name);
  await expect(page.getByTestId("account-empty")).toBeVisible();

  // Back out to the portfolio level, where the Accounts tab lives, and it
  // is in that list too.
  const id = await accountIdByName(page, name);
  await page.getByTestId("chip-account-clear").click();
  await page.getByTestId("tab-accounts").click();
  await expect(page.getByTestId(`account-row-${id}`)).toContainText(name);
  await expect(page.getByTestId(`account-row-${id}`)).toContainText(
    "Retirement",
  );
});

test("the Grid's Accounts list creates one too, and it shows up in that list", async ({
  page,
}) => {
  // AC 2, second entry point. Creation is permanently reachable from both,
  // rather than being an onboarding-only step.
  const name = uniqueName();
  await openDashboard(page);
  await openGrid(page);

  await page.getByTestId("grid-add-account").click();
  await fillNewAccount(page, name, { type: "crypto_exchange" });

  const id = await accountIdByName(page, name);
  await expect(page.getByTestId(`grid-account-${id}`)).toContainText(name);
  // No scope change from here: the Grid is a whole-portfolio cross-section.
  await expect(page.getByTestId("grid-total")).toBeVisible();
});

test("the form refuses an incomplete draft, with the reason on screen", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("all-accounts-chip").click();
  await page.getByTestId("accounts-sheet-option-__new__").click();

  await expect(page.getByTestId("account-status")).toHaveText(
    "Give the account a name.",
  );
  await expect(page.getByTestId("account-submit")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await page.getByTestId("account-input-name").fill("Somewhere");
  await expect(page.getByTestId("account-status")).toHaveText(
    "Say where it is held.",
  );

  await page.getByTestId("account-input-institution").fill("Some Bank");
  await expect(page.getByTestId("account-status")).toHaveCount(0);
  await expect(page.getByTestId("account-submit")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("a new account is immediately selectable as a transaction target", async ({
  page,
}) => {
  // AC 3. The catalog invalidation is the whole of it — the entry sheet
  // picks from what already exists (#22), so a stale catalog would make a
  // just-created account unusable for the rest of the session.
  const name = uniqueName();
  await openDashboard(page);
  await page.getByTestId("all-accounts-chip").click();
  await page.getByTestId("accounts-sheet-option-__new__").click();
  await fillNewAccount(page, name);

  const id = await accountIdByName(page, name);
  await page.getByTestId("portfolio-tab").getByTestId("entry-fab").click();
  await page.getByTestId("entry-row-account").click();
  await expect(page.getByTestId(`entry-picker-account-${id}`)).toContainText(
    name,
  );
});

// ─── Cascade delete ───────────────────────────────────────────

test("deleting an account states what it destroys, demands the name, and cascades", async ({
  page,
}) => {
  const name = uniqueName();
  const id = await fundedAccount(page, name);

  await openDashboard(page);
  // Scope the shared view state to it first, so the fallback in AC 7 has
  // something to fall back *from*.
  await page.getByTestId("all-accounts-chip").click();
  await page.getByTestId(`accounts-sheet-option-${id}`).click();
  await expect(page.getByTestId("chip-account")).toContainText(name);

  await openGrid(page);
  const brokerageBefore = await page
    .getByTestId(`grid-account-value-${BROKERAGE}`)
    .textContent();
  // What the Accounts list says this account is worth. The confirmation
  // has to restate the same figure — GOOG is priced from the real market
  // here, so pinning a literal would make this spec go stale on a
  // Tuesday.
  const doomedValue = await page
    .getByTestId(`grid-account-value-${id}`)
    .textContent();
  expect(doomedValue).toMatch(/^\$[\d,]/);

  await page.getByTestId("grid-remove-account").click();
  await expect(page.getByTestId("account-removal-sheet")).toBeVisible();
  await expect(
    page.getByTestId(`account-removal-sheet-note-${id}`),
  ).toContainText("Taxable brokerage");
  await page.getByTestId(`account-removal-sheet-option-${id}`).click();

  // AC 5: the number of transactions and the value being destroyed, in
  // concrete terms. The deposit and the buy are two; the buy's paired CASH
  // leg is the third row and is counted as a leg, exactly as the Activity
  // feed counts it (ADR-0001 § 2).
  const summary = page.getByTestId("account-delete-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("2 transactions");
  await expect(summary).toContainText("(plus the 1 paired cash leg");
  await expect(summary).toContainText(`${doomedValue} of tracked positions`);

  // AC 6: not one tap. The button is inert until the name is typed, and a
  // near miss is not enough.
  await expect(page.getByTestId("account-delete-submit")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByTestId("account-delete-confirm").fill(name.slice(0, -1));
  await expect(page.getByTestId("account-delete-submit")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await page.getByTestId("account-delete-confirm").fill(name);
  await expect(page.getByTestId("account-delete-submit")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByTestId("account-delete-submit").click();

  // AC 4: gone, along with its ledger, with no reload anywhere here.
  await expect(page.getByTestId("account-delete-sheet")).toHaveCount(0);
  await expect(page.getByTestId(`grid-account-${id}`)).toHaveCount(0);
  expect(await (await page.request.get(`${API}/accounts/${id}`)).status()).toBe(
    404,
  );
  const ledger = await (
    await page.request.get(`${API}/transactions?accounts=${id}`)
  ).json();
  expect(ledger).toEqual([]);

  // AC 8: the untouched account is untouched — same value, to the cent.
  await expect(page.getByTestId(`grid-account-value-${BROKERAGE}`)).toHaveText(
    brokerageBefore ?? "",
  );

  // AC 7: the view was scoped to it, and falls back to the whole portfolio
  // rather than showing a chip naming something that no longer exists.
  await page.getByTestId("nav-portfolio").click();
  await expect(page.getByTestId("chip-account")).toHaveCount(0);
  await expect(page.getByTestId("positions-loading")).toBeHidden();
  await expect(page.getByTestId(`holding-row-goog`)).toBeVisible();
});

test("the Activity feed loses the deleted account's rows, and keeps everyone else's", async ({
  page,
}) => {
  const name = uniqueName();
  const id = await fundedAccount(page, name);

  await openDashboard(page);
  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-loading")).toHaveCount(0);
  const scopeBefore = await page.getByTestId("activity-scope").textContent();
  await expect(
    page.getByTestId("activity-list").getByText(name, { exact: false }).first(),
  ).toBeVisible();

  await openGrid(page);
  await page.getByTestId("grid-remove-account").click();
  await page.getByTestId(`account-removal-sheet-option-${id}`).click();
  await page.getByTestId("account-delete-confirm").fill(name);
  await page.getByTestId("account-delete-submit").click();
  await expect(page.getByTestId("account-delete-sheet")).toHaveCount(0);

  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-loading")).toHaveCount(0);
  await expect(
    page.getByTestId("activity-list").getByText(name, { exact: false }),
  ).toHaveCount(0);
  // Two rows fewer than before — the deposit and the buy. The cash leg was
  // never shown, so it doesn't move this figure.
  const before = Number((scopeBefore ?? "").replace(/\D/g, ""));
  await expect(page.getByTestId("activity-scope")).toHaveText(
    `${before - 2} transactions`,
  );
});
