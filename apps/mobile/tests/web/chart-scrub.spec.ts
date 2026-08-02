import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8090";

/**
 * Chart scrub, pin and A→B compare (#15), in a real browser.
 *
 * The unit tier already proves the state machine and the timestamp-based
 * nearest-point resolution. What only a browser can answer is whether the
 * *gesture* reaches them: the responder handlers are spread onto a view,
 * `locationX` is measured against that view's box, and a chart whose view
 * is wider than its plot offsets every press silently — a bug no amount
 * of pure testing sees.
 */

test.beforeEach(async ({ page }) => {
  await page.request.post(`${API}/demo/seed`);
});

async function openDashboard(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("positions-list")).toBeVisible();
  await expect(page.getByTestId("chart-loading")).toBeHidden();
  await expect(page.getByTestId("portfolio-chart")).toBeVisible();
}

/** The plot's box, which is also the responder's box — `locationX` is
 * relative to it, so every coordinate below is an offset into it. */
async function plot(page: Page) {
  const box = await page.getByTestId("portfolio-chart").boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("chart has no box");
  return box;
}

/*
 * The crosshair and the pins are `<line>` elements one pixel wide and
 * zero pixels *across*, which Playwright scores as `hidden` — a bounding
 * box with no area. So they are asserted by count rather than by
 * visibility. The band is a `<rect>` with real area and is asserted
 * normally, which is also what makes it worth measuring below.
 */

/** A press that never moves — the tap the ~6px threshold is there to
 * admit. */
async function tapAt(page: Page, fraction: number) {
  const box = await plot(page);
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

test("dragging across the chart scrubs, and releasing leaves nothing pinned", async ({
  page,
}) => {
  await openDashboard(page);

  const box = await plot(page);
  const y = box.y + box.height / 2;
  const resting = await page.getByTestId("big-value").textContent();

  await expect(page.getByTestId("chart-hint")).toHaveText(
    /drag the chart to scrub/i,
  );

  await page.mouse.move(box.x + box.width * 0.15, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, y, { steps: 12 });

  // The crosshair is up, the hint has changed mode, and the readout is
  // now about the point under the pointer: a move against the previous
  // point and a dated caption carrying the move from the range start.
  await expect(page.getByTestId("portfolio-chart-crosshair")).toHaveCount(1);
  await expect(page.getByTestId("chart-hint")).toHaveText(/scrubbing/i);
  await expect(page.getByTestId("delta")).toHaveText(/vs prev$/);
  await expect(page.getByTestId("range-label")).toHaveText(/from start$/);
  const midway = await page.getByTestId("big-value").textContent();

  // Scrubbing somewhere else reads a different point, so the readout is
  // tracking the pointer rather than having switched to a fixed mode.
  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 12 });
  await expect(page.getByTestId("big-value")).not.toHaveText(midway ?? "");

  await page.mouse.up();

  // A press that travelled is a scrub, not a tap: back to the range's own
  // summary with nothing pinned.
  await expect(page.getByTestId("portfolio-chart-crosshair")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(0);
  await expect(page.getByTestId("chart-hint")).toHaveText(
    /drag the chart to scrub/i,
  );
  await expect(page.getByTestId("big-value")).toHaveText(resting ?? "");
  await expect(page.getByTestId("range-label")).toHaveText("past year");
});

test("a stationary tap pins, a second tap compares, and tapping the pin clears it", async ({
  page,
}) => {
  await openDashboard(page);

  await tapAt(page, 0.25);

  // Pinned: the point is marked, the readout is its change from the start
  // of the range, and the hint asks for the second tap.
  await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(1);
  await expect(page.getByTestId("portfolio-chart-pin-1")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-chart-band")).toHaveCount(0);
  await expect(page.getByTestId("chart-hint")).toHaveText(
    /pinned · tap another point to compare/i,
  );
  await expect(page.getByTestId("range-label")).toHaveText(/pinned/);
  const pinnedValue = await page.getByTestId("big-value").textContent();

  await tapAt(page, 0.8);

  // Comparing: both pins are up, the band between them is shaded, and the
  // readout is the A→B delta with a percent, captioned with both dates.
  await expect(page.getByTestId("portfolio-chart-pin-1")).toHaveCount(1);
  await expect(page.getByTestId("portfolio-chart-band")).toBeVisible();
  await expect(page.getByTestId("chart-hint")).toHaveText(/A → B compare/);
  await expect(page.getByTestId("delta")).toHaveText(/%$/);
  await expect(page.getByTestId("range-label")).toHaveText(/ → /);
  // The band really spans the two pins rather than being a token stripe.
  const band = await page.getByTestId("portfolio-chart-band").boundingBox();
  const plotBox = await plot(page);
  expect(band?.width ?? 0).toBeGreaterThan(plotBox.width * 0.4);

  // Tapping while comparing starts a fresh pair from the point tapped.
  await tapAt(page, 0.25);
  await expect(page.getByTestId("portfolio-chart-band")).toHaveCount(0);
  await expect(page.getByTestId("chart-hint")).toHaveText(/pinned/i);
  await expect(page.getByTestId("big-value")).toHaveText(pinnedValue ?? "");

  // And tapping the single pinned point again clears it.
  await tapAt(page, 0.25);
  await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(0);
  await expect(page.getByTestId("chart-hint")).toHaveText(
    /drag the chart to scrub/i,
  );
  await expect(page.getByTestId("range-label")).toHaveText("past year");
});

test("changing the range, the granularity or the metric clears the pins", async ({
  page,
}) => {
  await openDashboard(page);

  const pinTwo = async () => {
    await tapAt(page, 0.3);
    await tapAt(page, 0.75);
    await expect(page.getByTestId("portfolio-chart-band")).toBeVisible();
  };
  const expectCleared = async () => {
    await expect(page.getByTestId("portfolio-chart-band")).toHaveCount(0);
    await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(0);
    await expect(page.getByTestId("chart-hint")).toHaveText(
      /drag the chart to scrub/i,
    );
  };

  // The indices a pin holds only mean anything against the series they
  // were taken from, so every input that replaces that series drops them.
  await pinTwo();
  await page.getByTestId("range-3M").click();
  await expectCleared();

  await pinTwo();
  await page.getByTestId("granularity-chip").click();
  await page.getByTestId("granularity-sheet-option-daily").click();
  await expectCleared();

  await pinTwo();
  await page.getByTestId("metric-button").click();
  await page.getByTestId("metric-sheet-option-cost_basis").click();
  await expectCleared();
});

test("scrub and pin work on the bar rendering too", async ({ page }) => {
  await openDashboard(page);

  // Realized gain is the one Flow and draws as bars. The resolver reads
  // `pointXs`, which both renderings share, so the same gesture has to
  // reach the same machine — this is the half #19 deferred to here.
  await page.getByTestId("metric-button").click();
  await page.getByTestId("metric-sheet-option-realized_gain").click();
  await expect(page.getByTestId("chart-error")).toHaveCount(0);
  await expect(
    page.locator('[data-testid^="portfolio-chart-bar-"]').first(),
  ).toBeVisible();

  const box = await plot(page);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 10 });

  await expect(page.getByTestId("portfolio-chart-crosshair")).toHaveCount(1);
  await expect(page.getByTestId("chart-hint")).toHaveText(/scrubbing/i);
  // A Flow reads its bucket's own booking. It never shows "vs prev" or a
  // percentage: both are differences between two independent bucket
  // amounts, which is the comparison behaviour.md § Metrics rules out.
  await expect(page.getByTestId("delta")).toHaveText(/^booked /);
  await expect(page.getByTestId("delta")).not.toHaveText(/%/);

  await page.mouse.up();

  // Cumulative for the pin-to-compare half. Not for variety: the seed
  // books exactly one sell and `delta_per_period` drops empty buckets, so
  // a per-period year is a *single* bar — every tap lands on the same
  // point, and "tap a different point" has nothing to reach. Cumulative
  // carries the running total through the quiet months, which is the
  // ordinary shape a compare is for. Bars either way (README divergence
  // table).
  await page.getByTestId("mode-cumulative").click();
  await expect(page.getByTestId("mode-selected-cumulative")).toBeVisible();
  await expect(
    page.locator('[data-testid^="portfolio-chart-bar-"]').nth(3),
  ).toBeVisible();

  await tapAt(page, 0.2);
  await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(1);
  await expect(page.getByTestId("range-label")).toHaveText(/pinned/);

  await tapAt(page, 0.9);
  await expect(page.getByTestId("portfolio-chart-band")).toBeVisible();
  // The compare figure for a Flow is the total booked between the pins,
  // in dollars — not a percentage against the first of them.
  await expect(page.getByTestId("big-value")).toHaveText(/^[+−]\$/);
  await expect(page.getByTestId("delta")).toHaveText(/^booked over \d+ /);
  await expect(page.getByTestId("delta")).not.toHaveText(/%/);
  await expect(page.getByTestId("range-label")).toHaveText(/ → /);
});

test("a drag beyond the threshold does not register as a tap", async ({
  page,
}) => {
  await openDashboard(page);

  const box = await plot(page);
  const y = box.y + box.height / 2;
  const start = box.x + box.width * 0.5;

  // Well past ~6px and back to where it started. Nothing pins: the flag
  // latches on the way out rather than being re-read at release.
  await page.mouse.move(start, y);
  await page.mouse.down();
  await page.mouse.move(start + 60, y, { steps: 6 });
  await page.mouse.move(start, y, { steps: 6 });
  await page.mouse.up();

  await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(0);
  await expect(page.getByTestId("chart-hint")).toHaveText(
    /drag the chart to scrub/i,
  );

  // A press that stays inside the threshold still pins, so the test above
  // is measuring the threshold and not a broken tap path.
  await page.mouse.move(start, y);
  await page.mouse.down();
  await page.mouse.move(start + 3, y);
  await page.mouse.up();

  await expect(page.getByTestId("portfolio-chart-pin-0")).toHaveCount(1);
});
