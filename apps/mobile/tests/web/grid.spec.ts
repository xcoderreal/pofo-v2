import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

const BROKERAGE = "demo-dev-user-brokerage";
const IRA = "demo-dev-user-ira";
const COINBASE = "demo-dev-user-coinbase";
/** Deposits and one withdrawal, no instruments — the account whose column
 * behaviour.md § Grid says must not appear. */
const RESERVE = "demo-dev-user-reserve";

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openGrid(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-loading")).toHaveCount(0);
  await expect(page.getByTestId("grid-total")).toBeVisible();
}

test("the total tile is holdings plus cash, with a change over the past year", async ({
  page,
}) => {
  await openGrid(page);

  // A real figure computed from the seed, not a placeholder and not the
  // $0 a total price-fetch failure would silently produce.
  await expect(page.getByTestId("grid-total")).toHaveText(
    /\$[\d,]*[1-9][\d,]*/,
  );
  await expect(page.getByTestId("grid-total-change")).toHaveText(
    /[+−]\$[\d,.]+\s+[+−][\d.]+%/,
  );

  // The two halves do not overlap (ADR-0001 § 3), so the tile must exceed
  // the Portfolio tab's holdings-only headline by the cash balance rather
  // than equalling it.
  const total = await page.getByTestId("grid-total").textContent();
  await page.getByTestId("nav-portfolio").click();
  const equityOnly = await page.getByTestId("big-value").textContent();
  expect(money(total)).toBeGreaterThan(money(equityOnly));
});

test("the allocation bar has one segment per funded account and a legend that adds to 100", async ({
  page,
}) => {
  await openGrid(page);

  for (const id of [BROKERAGE, IRA, COINBASE, RESERVE]) {
    await expect(page.getByTestId(`allocation-segment-${id}`)).toBeVisible();
  }

  const legend = await page
    .getByTestId(/^allocation-percent-/)
    .allTextContents();
  expect(legend).toHaveLength(4);
  const sum = legend.reduce((total, text) => total + parseInt(text, 10), 0);
  // Each entry is rounded to a whole percent, so four of them can drift a
  // couple of points off 100 without the underlying shares being wrong.
  expect(Math.abs(sum - 100)).toBeLessThanOrEqual(2);
});

test("a tap on an allocation segment drills into that account", async ({
  page,
}) => {
  await openGrid(page);
  await page.getByTestId(`allocation-segment-${COINBASE}`).click();

  await expect(page.getByTestId("portfolio-screen")).toBeVisible();
  await expect(page.getByTestId("chip-account")).toContainText("Coinbase");
});

test("the matrix has a row for every live instrument and a column for every account holding one", async ({
  page,
}) => {
  await openGrid(page);

  // Everything the seed still holds.
  for (const symbol of ["goog", "voo", "vti", "aapl", "btc"]) {
    await expect(page.getByTestId(`matrix-row-${symbol}`)).toBeVisible();
  }
  // TSLA was bought and fully sold: a row of dots with a $0 in it.
  await expect(page.getByTestId("matrix-row-tsla")).toHaveCount(0);

  for (const id of [BROKERAGE, IRA, COINBASE]) {
    await expect(page.getByTestId(`matrix-column-${id}`)).toBeVisible();
  }
  // Cash-only, so its column would be entirely empty — the rule
  // behaviour.md § Grid makes explicit.
  await expect(page.getByTestId(`matrix-column-${RESERVE}`)).toHaveCount(0);
});

test("cells with no holding are marked and are not tappable", async ({
  page,
}) => {
  await openGrid(page);

  // BTC is only ever bought on Coinbase.
  await expect(page.getByTestId(`matrix-cell-btc-${COINBASE}`)).toHaveText(
    /^\$/,
  );
  await expect(page.getByTestId(`matrix-empty-btc-${BROKERAGE}`)).toHaveText(
    "·",
  );
  // Distinct elements, not one element in two states: the empty one is
  // not a pressable at all.
  await expect(page.getByTestId(`matrix-cell-btc-${BROKERAGE}`)).toHaveCount(0);
});

test("tapping a cell navigates to that slice", async ({ page }) => {
  await openGrid(page);
  await page.getByTestId(`matrix-cell-goog-${IRA}`).click();

  await expect(page.getByTestId("portfolio-screen")).toBeVisible();
  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("chip-account")).toContainText(
    "Wells Fargo IRA",
  );
  // A slice, not the whole portfolio wearing two chips.
  await expect(page.getByTestId("holding-row-goog")).toBeVisible();
  await expect(page.getByTestId("holding-row-voo")).toHaveCount(0);
});

test("a row header goes to the instrument and a column header to the account", async ({
  page,
}) => {
  await openGrid(page);

  await page.getByTestId("matrix-row-goog").click();
  await expect(page.getByTestId("chip-instrument")).toContainText("GOOG");
  await expect(page.getByTestId("chip-account")).toHaveCount(0);

  // Back to the Grid with an instrument still selected: a column header
  // means that account across *everything*, so the instrument chip goes.
  await page.getByTestId("nav-grid").click();
  await page.getByTestId(`matrix-column-${BROKERAGE}`).click();
  await expect(page.getByTestId("chip-account")).toContainText(
    "Wells Fargo Brokerage",
  );
  await expect(page.getByTestId("chip-instrument")).toHaveCount(0);
});

test.describe("on a phone-sized viewport", () => {
  // The design's own target (docs/design/dashboard_v2/README.md), and
  // narrow enough that three account columns genuinely overflow.
  test.use({ viewport: { width: 390, height: 844 } });

  test("the matrix scrolls sideways with the symbol column pinned", async ({
    page,
  }) => {
    await openGrid(page);

    const overflows = await page
      .getByTestId("matrix-hscroll")
      .evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(overflows).toBe(true);

    // Pinned means *outside* the scroller, not merely first inside it.
    const pinnedInsideScroller = await page
      .getByTestId("matrix-hscroll")
      .evaluate((node) =>
        node.contains(document.querySelector('[data-testid="matrix-symbol-column"]')),
      );
    expect(pinnedInsideScroller).toBe(false);

    // Scroll to the far right; the symbol column has not moved.
    const before = await boundingX(page, "matrix-row-goog");
    await page
      .getByTestId("matrix-hscroll")
      .evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
    await expect(page.getByTestId("matrix-row-goog")).toBeVisible();
    expect(await boundingX(page, "matrix-row-goog")).toBeCloseTo(before, 0);
  });

  test("the matrix scrolls vertically without truncating rows", async ({
    page,
  }) => {
    await openGrid(page);

    const scrollable = await page
      .getByTestId("matrix-vscroll")
      .evaluate((node) => getComputedStyle(node).overflowY);
    expect(["auto", "scroll"]).toContain(scrollable);

    // Every live instrument is in the DOM whether or not it fits.
    await expect(page.getByTestId(/^matrix-row-/)).toHaveCount(5);
  });
});

test("the accounts list draws a sparkline per account from one grouped query", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Counted from the moment the Grid is opened, so the Portfolio tab's own
  // queries don't pollute the tally.
  const grouped: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/portfolio/query") && url.includes("group_by=account")) {
      grouped.push(new URL(url).searchParams.get("metric") ?? "");
    }
  });

  await page.getByTestId("nav-grid").click();
  await expect(page.getByTestId("grid-total")).toBeVisible();

  for (const id of [BROKERAGE, IRA, COINBASE, RESERVE]) {
    await expect(page.getByTestId(`grid-account-${id}`)).toBeVisible();
    await expect(page.getByTestId(`grid-spark-${id}`)).toBeVisible();
    await expect(page.getByTestId(`grid-account-value-${id}`)).toHaveText(
      /^\$[\d,]/,
    );
  }

  // Two, not one per account: `equity` excludes CASH so account value is
  // the sum of two grouped series (ADR-0001 §§ 3 and 5). Four accounts
  // would be four calls each if the sparklines were fetched per row.
  expect(grouped.sort()).toEqual(["cash_balance", "equity"]);
});

/** `$73,005` -> 73005. The app renders a typographic minus, which
 * `parseFloat` doesn't know about — no negative totals here, but the
 * helper shouldn't quietly return NaN if one ever appears. */
function money(text: string | null): number {
  return Number((text ?? "").replace(/[^0-9.]/g, ""));
}

async function boundingX(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  return box?.x ?? NaN;
}
