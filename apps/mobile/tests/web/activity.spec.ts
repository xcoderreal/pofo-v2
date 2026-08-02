import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

const COINBASE = "demo-dev-user-coinbase";

/**
 * The seed's ids are stable; the *dates* are not — every event is
 * `days_ago` from the real clock, so month labels move. Assertions here
 * are on ids, counts and structure, never on a hardcoded month.
 */
const TSLA_SELL = "demo-dev-user-tx-12"; // 90 @ 288, opened at 250
const WITHDRAWAL = "demo-dev-user-tx-14"; // 4,000 off the cash-only account
const DEPOSIT = "demo-dev-user-tx-16"; // 10,000 into the brokerage
const GOOG_BUY = "demo-dev-user-tx-19"; // 25 @ 186, the newest row

/** 20 user actions in the seed; 12 of them are trades, each of which also
 * auto-posts a CASH leg. So the feed is 20 and the ledger is 32 — the gap
 * this tab's suppression rule exists to close. */
const VISIBLE_ROWS = 20;
const LEDGER_ROWS = 32;

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openActivity(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-loading")).toHaveCount(0);
  await expect(page.getByTestId("activity-scope")).toBeVisible();
}

test("transactions are grouped by month, newest first, each headed with its net", async ({
  page,
}) => {
  await openActivity(page);

  const labels = await page.getByTestId(/^activity-month-label-/).allTextContents();
  expect(labels.length).toBeGreaterThan(1);
  for (const label of labels) {
    // Uppercased by CSS, so the DOM text is still "June 2026".
    expect(label).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  }

  // Newest first: the group keys are sortable strings, so the rendered
  // order must already be descending.
  const keys = await page
    .getByTestId(/^activity-month-label-/)
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        (node.getAttribute("data-testid") ?? "").replace(
          "activity-month-label-",
          "",
        ),
      ),
    );
  expect(keys).toEqual([...keys].sort().reverse());

  // Every group is headed with a net cash movement, signed.
  const nets = await page.getByTestId(/^activity-month-net-/).allTextContents();
  expect(nets).toHaveLength(labels.length);
  for (const net of nets) {
    expect(net).toMatch(/^[+−]\$[\d,.]+ net$/);
  }

  // The newest row belongs to the newest group.
  const firstGroupKey = keys[0];
  await expect(
    page
      .getByTestId(`activity-month-${firstGroupKey}`)
      .getByTestId(`activity-row-${GOOG_BUY}`),
  ).toBeVisible();
});

test("a trade's paired CASH leg is hidden and a real deposit is not", async ({
  page,
}) => {
  const ledger = await (await page.request.get(`${API}/transactions`)).json();
  expect(ledger).toHaveLength(LEDGER_ROWS);
  // The server ships every row, `trade_id` and all — the client is what
  // applies the rule (docs/adr/0001-dashboard-v2.md § 2).
  expect(
    ledger.filter(
      (row: { instrument_id: string; trade_id: string | null }) =>
        row.instrument_id === "cash" && row.trade_id !== null,
    ),
  ).toHaveLength(LEDGER_ROWS - VISIBLE_ROWS);

  await openActivity(page);

  await expect(page.getByTestId(/^activity-row-/)).toHaveCount(VISIBLE_ROWS);
  // Every auto-posted leg's id is its trade's id plus "-cash". None render.
  await expect(page.getByTestId(/^activity-row-.*-cash$/)).toHaveCount(0);
  // And its trade does.
  await expect(page.getByTestId(`activity-row-${GOOG_BUY}`)).toBeVisible();
});

test("deposits and withdrawals render as their own badge types", async ({
  page,
}) => {
  await openActivity(page);

  await expect(page.getByTestId(`activity-badge-${DEPOSIT}`)).toHaveText("DEP");
  await expect(page.getByTestId(`activity-description-${DEPOSIT}`)).toHaveText(
    "Cash deposit",
  );
  await expect(page.getByTestId(`activity-amount-${DEPOSIT}`)).toHaveText(
    "+$10,000",
  );

  await expect(page.getByTestId(`activity-badge-${WITHDRAWAL}`)).toHaveText("WDL");
  await expect(page.getByTestId(`activity-description-${WITHDRAWAL}`)).toHaveText(
    "Cash withdrawal",
  );
  await expect(page.getByTestId(`activity-amount-${WITHDRAWAL}`)).toHaveText(
    "−$4,000.00",
  );

  // Not "SELL USD · 4,000 @ $1.00", which is what the ledger literally
  // stores (docs/domain-model.md).
  const badges = await page.getByTestId(/^activity-badge-/).allTextContents();
  expect(new Set(badges)).toEqual(new Set(["BUY", "SELL", "DEP", "WDL"]));
});

test("a row carries a badge, a description, its account, the date and a signed amount", async ({
  page,
}) => {
  await openActivity(page);

  await expect(page.getByTestId(`activity-badge-${GOOG_BUY}`)).toHaveText("BUY");
  await expect(page.getByTestId(`activity-description-${GOOG_BUY}`)).toHaveText(
    "GOOG · 25 @ $186.00",
  );
  await expect(page.getByTestId(`activity-subtitle-${GOOG_BUY}`)).toHaveText(
    /^Wells Fargo Brokerage · [A-Z][a-z]{2} \d{1,2}, \d{4}$/,
  );
  await expect(page.getByTestId(`activity-amount-${GOOG_BUY}`)).toHaveText(
    "−$4,650.00",
  );
});

test("a sell shows the realized gain it booked, and a buy shows none", async ({
  page,
}) => {
  await openActivity(page);

  await expect(page.getByTestId(`activity-badge-${TSLA_SELL}`)).toHaveText("SELL");
  // (288 − 250) × 90. The figure of *that sell*, not the position's
  // lifetime total.
  await expect(page.getByTestId(`activity-realized-${TSLA_SELL}`)).toHaveText(
    "+$3,420.00 realized",
  );

  await expect(page.getByTestId(`activity-realized-${GOOG_BUY}`)).toHaveCount(0);
  // A withdrawal books a definitional zero — not shown at all.
  await expect(page.getByTestId(`activity-realized-${WITHDRAWAL}`)).toHaveCount(0);
});

test("the header counts the feed and says when it is filtered", async ({
  page,
}) => {
  await openActivity(page);

  await expect(page.getByTestId("activity-scope")).toHaveText(
    `${VISIBLE_ROWS} transactions`,
  );
  // No scope, so no chip row on this screen at all.
  await expect(
    page.getByTestId("activity-screen").getByTestId("scope-chips"),
  ).toHaveCount(0);
});

test("an account filter narrows the list and the header reflects it", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // The scope is the app's, not the screen's: selected on the Grid, read
  // here (behaviour.md § Activity).
  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-total")).toBeVisible();
  await page.getByTestId(`allocation-segment-${COINBASE}`).click();

  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-loading")).toHaveCount(0);

  await expect(
    page.getByTestId("activity-screen").getByTestId("chip-account"),
  ).toContainText("Coinbase");
  // Two deposits and two BTC buys, and not one row from anywhere else.
  await expect(page.getByTestId("activity-scope")).toHaveText("4 matching");
  await expect(page.getByTestId(/^activity-row-/)).toHaveCount(4);
  await expect(page.getByTestId(`activity-row-${GOOG_BUY}`)).toHaveCount(0);
  // Still no phantom cash rows beside the two buys.
  await expect(page.getByTestId(/^activity-row-.*-cash$/)).toHaveCount(0);

  // Dismissing the chip widens it back, with the same Undo contract the
  // Portfolio tab offers.
  await page
    .getByTestId("activity-screen")
    .getByTestId("chip-account-clear")
    .click();
  await expect(
    page.getByTestId("activity-screen").getByTestId("undo-toast"),
  ).toBeVisible();
  await expect(page.getByTestId("activity-scope")).toHaveText(
    `${VISIBLE_ROWS} transactions`,
  );
});

test("an instrument filter narrows the list to that instrument", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-total")).toBeVisible();
  await page.getByTestId("matrix-row-btc").click();

  await page.getByTestId("nav-activity").click();
  await expect(page.getByTestId("activity-loading")).toHaveCount(0);

  await expect(
    page.getByTestId("activity-screen").getByTestId("chip-instrument"),
  ).toContainText("BTC");
  // Two BTC buys across the portfolio; the deposits that funded them are
  // a different instrument and drop out with the filter.
  await expect(page.getByTestId("activity-scope")).toHaveText("2 matching");
  const descriptions = await page
    .getByTestId(/^activity-description-/)
    .allTextContents();
  expect(descriptions).toHaveLength(2);
  for (const description of descriptions) {
    expect(description).toMatch(/^BTC-USD · /);
  }
});

test("an empty ledger shows an empty state", async ({ page }) => {
  await page.route("**/transactions", async (route) => {
    await route.fulfill({ json: [] });
  });

  await openActivity(page);

  await expect(page.getByTestId("activity-empty")).toBeVisible();
  await expect(page.getByTestId("activity-empty")).toContainText(
    "Nothing here yet",
  );
  await expect(page.getByTestId(/^activity-row-/)).toHaveCount(0);
  await expect(page.getByTestId("activity-scope")).toHaveText("0 transactions");
});
