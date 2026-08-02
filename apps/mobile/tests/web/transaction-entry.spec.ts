import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

const BROKERAGE = "demo-dev-user-brokerage";
const IRA = "demo-dev-user-ira";

/**
 * The transaction entry sheet (#22) — the only way data gets in.
 *
 * **This is the suite's only writing spec**, and it runs in the
 * `chromium-writes` project, which depends on the read-only `chromium`
 * one (`playwright.config.ts`). The backend is a single process with an
 * in-memory repository and no purge endpoint yet (#29), so anything
 * recorded here would otherwise land in the row counts and totals the
 * other specs assert exactly.
 *
 * Within that, every write goes into an account this file creates, with an
 * id unique to the run: `reuseExistingServer` means a local re-run can
 * find the previous run's rows still there, and an assertion about "the
 * account's cash" must not depend on how many times the suite has been
 * run.
 */

let accountSeq = 0;

/** A brand-new, unfunded account — the starting position for ADR-0001
 * § 4's story: a buy before the deposit that pays for it is rejected. */
async function freshAccount(page: Page): Promise<string> {
  const id = `entry-spec-${Date.now().toString(36)}-${accountSeq++}`;
  const response = await page.request.post(`${API}/accounts`, {
    data: {
      id,
      name: `Entry Spec ${accountSeq}`,
      institution: "Entry Spec Bank",
      account_type: "brokerage",
    },
  });
  expect(response.status()).toBe(201);
  return id;
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
}

/**
 * The FAB belonging to one tab's screen.
 *
 * Scoped rather than looked up globally, the same way the existing specs
 * scope `activity-screen`: expo-router keeps a visited tab mounted and
 * merely stacked behind the active one, so a bare `getByTestId` finds
 * every FAB the session has ever rendered and hits strict mode. Which
 * screen a FAB belongs to is the thing AC 1 is actually about.
 */
const fabOn = (page: Page, screen: string) =>
  page.getByTestId(screen).getByTestId("entry-fab");

async function openSheet(page: Page, screen = "portfolio-tab") {
  await fabOn(page, screen).click();
  await expect(page.getByTestId("entry-sheet")).toBeVisible();
}

test("the FAB opens the sheet from Portfolio and Activity, and is absent from the Grid", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(fabOn(page, "portfolio-tab")).toHaveCount(1);

  // The Grid carries no scope of its own — a tap there selects one and
  // hands you to the Portfolio tab — so the sheet could only ever open
  // unprefilled from here.
  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-total")).toBeVisible();
  await expect(fabOn(page, "grid-screen")).toHaveCount(0);

  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-scope")).toBeVisible();
  await openSheet(page, "activity-screen");
  await expect(page.getByTestId("entry-sheet-title")).toHaveText(
    "Add transaction",
  );
});

test("each type shows its own fields, and a cash movement has no instrument", async ({
  page,
}) => {
  await openDashboard(page);
  await openSheet(page);

  // Buy is the default from the whole-portfolio view.
  await expect(page.getByTestId("entry-type-selected-buy")).toBeVisible();
  await expect(page.getByTestId("entry-row-instrument")).toBeVisible();
  await expect(page.getByTestId("entry-input-quantity")).toBeVisible();
  await expect(page.getByTestId("entry-input-price")).toBeVisible();
  await expect(page.getByTestId("entry-input-amount")).toHaveCount(0);

  await page.getByTestId("entry-type-sell").click();
  await expect(page.getByTestId("entry-type-selected-sell")).toBeVisible();
  await expect(page.getByTestId("entry-row-instrument")).toBeVisible();

  for (const kind of ["deposit", "withdrawal"]) {
    await page.getByTestId(`entry-type-${kind}`).click();
    await expect(page.getByTestId(`entry-type-selected-${kind}`)).toBeVisible();
    // A deposit is a BUY of the CASH instrument underneath, but asking a
    // user to pick "USD" is not the mental model (docs/domain-model.md).
    await expect(page.getByTestId("entry-row-instrument")).toHaveCount(0);
    await expect(page.getByTestId("entry-input-quantity")).toHaveCount(0);
    await expect(page.getByTestId("entry-input-amount")).toBeVisible();
    await expect(page.getByTestId("entry-input-date")).toBeVisible();
  }
});

test("opened from the whole-portfolio view, the sheet says nothing was prefilled", async ({
  page,
}) => {
  await openDashboard(page);
  await openSheet(page);

  await expect(page.getByTestId("entry-context-note")).toContainText(
    "Nothing was prefilled",
  );
  await expect(page.getByTestId("entry-row-account-value")).toHaveText("Choose…");
  await expect(page.getByTestId("entry-row-account-tag")).toHaveCount(0);
  await expect(page.getByTestId("entry-row-instrument-tag")).toHaveCount(0);
  // Not silently un-pressable with no reason given.
  await expect(page.getByTestId("entry-status")).toHaveText(
    "Choose the account this belongs to.",
  );
});

test("opened from a slice, both slots prefill, stay editable, and the price comes from the market", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId(`breakdown-row-${BROKERAGE}`).click();
  await expect(page.getByTestId("chip-account")).toContainText("Wells Fargo");

  await openSheet(page);

  await expect(page.getByTestId("entry-sheet-title")).toHaveText(
    "Add GOOG in Wells Fargo Brokerage",
  );
  await expect(page.getByTestId("entry-context-note")).toContainText(
    "Prefilled from the view",
  );
  await expect(page.getByTestId("entry-row-account-value")).toHaveText(
    "Wells Fargo Brokerage",
  );
  await expect(page.getByTestId("entry-row-instrument-value")).toHaveText("GOOG");
  await expect(page.getByTestId("entry-row-account-tag")).toHaveText("from view");
  await expect(page.getByTestId("entry-row-instrument-tag")).toHaveText(
    "from view",
  );

  // Price per unit prefills from the latest known market price.
  await expect(page.getByTestId("entry-input-price")).toHaveValue(
    /^\d+(\.\d+)?$/,
  );

  // Marked, but not locked: the picker changes it and the tag goes away.
  await page.getByTestId("entry-row-account").click();
  await page.getByTestId(`entry-picker-account-${IRA}`).click();
  await expect(page.getByTestId("entry-row-account-value")).toHaveText(
    "Wells Fargo IRA",
  );
  await expect(page.getByTestId("entry-row-account-tag")).toHaveCount(0);
  await expect(page.getByTestId("entry-row-instrument-tag")).toHaveText(
    "from view",
  );
});

test("a sell shows the units held in scope and refuses to exceed them", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByTestId("holding-row-goog").click();
  await page.getByTestId(`breakdown-row-${BROKERAGE}`).click();
  await openSheet(page);

  await page.getByTestId("entry-type-sell").click();
  // 60 + 25 bought in the brokerage by the seed.
  await expect(page.getByTestId("entry-hint")).toHaveText(
    "85 held in Wells Fargo Brokerage",
  );

  // Priced explicitly so the reason on screen is about the quantity and
  // not about a price prefill that may still be in flight.
  await page.getByTestId("entry-input-price").fill("200");
  await page.getByTestId("entry-input-quantity").fill("86");
  await expect(page.getByTestId("entry-status")).toHaveText(
    "Only 85 units are held in this scope — a sell cannot exceed that.",
  );
  await expect(page.getByTestId("entry-submit")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await page.getByTestId("entry-input-quantity").fill("85");
  await expect(page.getByTestId("entry-status")).toHaveCount(0);
  await expect(page.getByTestId("entry-submit")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("a buy shows cash available; without it the buy is rejected, and the Deposit unblocks it", async ({
  page,
}) => {
  // The whole of ADR-0001 § 4 in one flow: a trade auto-posts a CASH leg,
  // an overdraw on that leg is rejected, and the fix is to record the
  // funding Deposit that belongs before it.
  const accountId = await freshAccount(page);
  await openDashboard(page);
  await openSheet(page);

  await page.getByTestId("entry-row-account").click();
  await page.getByTestId(`entry-picker-account-${accountId}`).click();
  await page.getByTestId("entry-row-instrument").click();
  await page.getByTestId("entry-picker-instrument-goog").click();

  // AC 7: the buy states what the account has to pay with — and a
  // brand-new account, which has no CASH position row at all, reads as
  // $0.00 rather than as unknown.
  await expect(page.getByTestId("entry-hint")).toHaveText(
    /^\$0\.00 cash available in Entry Spec/,
  );

  await page.getByTestId("entry-input-quantity").fill("2");
  await page.getByTestId("entry-input-price").fill("100");
  await expect(page.getByTestId("entry-status")).toHaveCount(0);
  await page.getByTestId("entry-submit").click();

  // AC 8: the server rejected the auto-posted CASH leg, and the sheet says
  // so in words with an action in them.
  const error = page.getByTestId("entry-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Not enough cash");
  await expect(error).toContainText("$200.00");
  await expect(error).toContainText("Record the funding Deposit");
  // The sheet stays open on the draft that was refused.
  await expect(page.getByTestId("entry-sheet")).toBeVisible();

  // Record the Deposit the message asked for, without leaving the sheet.
  await page.getByTestId("entry-type-deposit").click();
  await page.getByTestId("entry-input-amount").fill("5000");
  await page.getByTestId("entry-submit").click();

  // AC 9: on success the sheet closes, and the account's row carries the
  // new balance with no reload anywhere in this test.
  await expect(page.getByTestId("entry-sheet")).toHaveCount(0);
  await page.getByTestId("tab-accounts").click();
  await expect(page.getByTestId(`account-value-${accountId}`)).toHaveText(
    "$5,000.00",
  );

  // Now the same buy goes through.
  await openSheet(page);
  await page.getByTestId("entry-row-account").click();
  await page.getByTestId(`entry-picker-account-${accountId}`).click();
  await page.getByTestId("entry-row-instrument").click();
  await page.getByTestId("entry-picker-instrument-goog").click();
  await expect(page.getByTestId("entry-hint")).toHaveText(
    /^\$5,000\.00 cash available in Entry Spec/,
  );
  await page.getByTestId("entry-input-quantity").fill("2");
  await page.getByTestId("entry-input-price").fill("100");
  await page.getByTestId("entry-submit").click();
  await expect(page.getByTestId("entry-sheet")).toHaveCount(0);

  // The holding, the cash it was paid for with, and the feed — all three
  // reflect it without a manual refresh.
  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-loading")).toHaveCount(0);
  const descriptions = await page
    .getByTestId(/^activity-description-/)
    .allTextContents();
  expect(descriptions).toContain("GOOG · 2 @ $100.00");
  // The trade's paired CASH leg is still suppressed; only the Deposit and
  // the buy show for this account.
  await expect(page.getByTestId(/^activity-row-.*-cash$/)).toHaveCount(0);

  // …and the cash it was paid for with: reopening the sheet reads a
  // freshly-invalidated positions query, so the same hint that said
  // $5,000.00 a moment ago now nets off the $200 the CASH leg took.
  await page.getByTestId("nav-portfolio").click();
  await expect(page.getByTestId("positions-loading")).toBeHidden();
  await openSheet(page);
  await page.getByTestId("entry-row-account").click();
  await page.getByTestId(`entry-picker-account-${accountId}`).click();
  await expect(page.getByTestId("entry-hint")).toHaveText(
    /^\$4,800\.00 cash available in Entry Spec/,
  );
});
