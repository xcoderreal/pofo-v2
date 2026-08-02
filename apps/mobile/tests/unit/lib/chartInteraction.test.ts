import { describe, expect, test } from "bun:test";
import {
  beginScrub,
  cancelScrub,
  chartHint,
  chartMode,
  clampSelection,
  endGesture,
  IDLE_SELECTION,
  isDrag,
  moveScrub,
  selectionResetKey,
  TAP_SLOP_PX,
  type ChartSelection,
} from "@/lib/chartInteraction";
import { INITIAL_VIEW_STATE, type ViewState } from "@/lib/drilldown";

/** A press: down at `startX`, moved to each `xs`, released at the last. */
function press(
  selection: ChartSelection,
  startX: number,
  xs: number[],
  indexAt: (x: number) => number,
): ChartSelection {
  let moved = false;
  let current = beginScrub(selection, indexAt(startX));
  for (const x of xs) {
    if (isDrag(startX, x)) moved = true;
    current = moveScrub(current, indexAt(x));
  }
  const endX = xs.length ? xs[xs.length - 1] : startX;
  return endGesture(current, { index: indexAt(endX), moved });
}

/** Ten evenly-spaced points across 1000px, so a pixel maps to a point
 * without the test having to do timestamp arithmetic — that part is
 * `nearestPointIndex`'s own test. */
const at = (x: number) => Math.max(0, Math.min(9, Math.round(x / 100)));

describe("chartMode", () => {
  test("idle is nothing selected", () => {
    expect(chartMode(IDLE_SELECTION)).toBe("idle");
  });

  test("a live scrub outranks the pins it is passing over", () => {
    // The finger is asking about the point under it, not about a pin it
    // happens to cross — and the pins survive to be shown again on
    // release.
    expect(
      chartMode({ scrubIndex: 4, pinA: 1, pinB: 7 }),
    ).toBe("scrub");
  });

  test("two pins is compare, one is pinned", () => {
    expect(chartMode({ scrubIndex: null, pinA: 1, pinB: 7 })).toBe("compare");
    expect(chartMode({ scrubIndex: null, pinA: 1, pinB: null })).toBe("pinned");
  });
});

describe("tap vs. drag", () => {
  test("the threshold is ~6px, per behaviour.md", () => {
    expect(TAP_SLOP_PX).toBe(6);
  });

  test("a press that stayed inside the slop is still a tap", () => {
    // No real touch is stationary; without slack every pin would land as
    // a one-frame scrub instead.
    expect(isDrag(200, 200)).toBe(false);
    expect(isDrag(200, 206)).toBe(false);
    expect(isDrag(200, 194)).toBe(false);
  });

  test("a press beyond it is a drag, in either direction", () => {
    expect(isDrag(200, 207)).toBe(true);
    expect(isDrag(200, 193)).toBe(true);
  });

  test("a drag that wanders past the threshold and back never re-becomes a tap", () => {
    // The flag is latched by the caller, which is what this asserts
    // through `press`: out to 260 and back to the starting pixel still
    // releases with nothing pinned.
    const after = press(IDLE_SELECTION, 200, [260, 200], at);

    expect(after).toEqual(IDLE_SELECTION);
  });
});

describe("the gesture, end to end", () => {
  test("pressing down shows the point immediately", () => {
    const after = beginScrub(IDLE_SELECTION, 3);

    expect(chartMode(after)).toBe("scrub");
    expect(after.scrubIndex).toBe(3);
  });

  test("a drag scrubs and leaves nothing behind", () => {
    const after = press(IDLE_SELECTION, 100, [300, 500, 640], at);

    expect(after).toEqual(IDLE_SELECTION);
  });

  test("a drag over a pinned chart returns to the pin rather than losing it", () => {
    const pinned: ChartSelection = { scrubIndex: null, pinA: 2, pinB: null };

    const during = moveScrub(beginScrub(pinned, 5), 7);
    expect(chartMode(during)).toBe("scrub");

    const after = press(pinned, 100, [500, 700], at);
    expect(after).toEqual(pinned);
    expect(chartMode(after)).toBe("pinned");
  });

  test("a stationary tap pins", () => {
    const after = press(IDLE_SELECTION, 400, [402], at);

    expect(after).toEqual({ scrubIndex: null, pinA: 4, pinB: null });
    expect(chartMode(after)).toBe("pinned");
  });

  test("a second tap elsewhere enters compare, keeping the first as A", () => {
    const pinned = press(IDLE_SELECTION, 200, [], at);
    const compared = press(pinned, 700, [703], at);

    expect(compared).toEqual({ scrubIndex: null, pinA: 2, pinB: 7 });
    expect(chartMode(compared)).toBe("compare");
  });

  test("tapping the single pinned point again clears it", () => {
    const pinned = press(IDLE_SELECTION, 500, [], at);

    expect(press(pinned, 498, [], at)).toEqual(IDLE_SELECTION);
  });

  test("a tap while comparing starts a fresh pair from the point tapped", () => {
    // Not a no-op and not a full clear: the second pin is what the tap
    // would otherwise be fighting with, so the pair resets to the point
    // just tapped and invites a new B.
    const compared: ChartSelection = { scrubIndex: null, pinA: 2, pinB: 7 };

    const after = press(compared, 400, [], at);

    expect(after).toEqual({ scrubIndex: null, pinA: 4, pinB: null });
    expect(chartMode(after)).toBe("pinned");
  });

  test("clearing the second pin is a tap on it, which re-pins rather than un-comparing", () => {
    const compared: ChartSelection = { scrubIndex: null, pinA: 2, pinB: 7 };

    expect(press(compared, 700, [], at)).toEqual({
      scrubIndex: null,
      pinA: 7,
      pinB: null,
    });
  });

  test("a gesture taken away by a parent drops the scrub and keeps the pins", () => {
    // The vertical scroll view claiming the gesture must not also
    // discard a pin the user placed before the scroll.
    const during: ChartSelection = { scrubIndex: 6, pinA: 2, pinB: null };

    expect(cancelScrub(during)).toEqual({
      scrubIndex: null,
      pinA: 2,
      pinB: null,
    });
  });

  test("releasing over nothing resolvable is a no-op, not a pin at index 0", () => {
    // `nearestPointIndex` answers null only for an empty series, and
    // pinning "point zero" of no points would render `$NaN`.
    expect(
      endGesture({ scrubIndex: null, pinA: 3, pinB: null }, {
        index: null,
        moved: false,
      }),
    ).toEqual({ scrubIndex: null, pinA: 3, pinB: null });
  });
});

describe("clampSelection", () => {
  test("keeps everything a shorter series can still answer for", () => {
    // A background refetch returning fewer buckets must not leave the
    // readout indexing past the end.
    expect(clampSelection({ scrubIndex: 9, pinA: 2, pinB: 8 }, 5)).toEqual({
      scrubIndex: null,
      pinA: 2,
      pinB: null,
    });
  });

  test("a surviving B with no A becomes the single pin", () => {
    // "B without A" is not a state the machine has — it would read as a
    // compare against nothing.
    expect(clampSelection({ scrubIndex: null, pinA: 7, pinB: 1 }, 5)).toEqual({
      scrubIndex: null,
      pinA: 1,
      pinB: null,
    });
  });

  test("an emptied series clears everything", () => {
    expect(clampSelection({ scrubIndex: 1, pinA: 0, pinB: 2 }, 0)).toEqual(
      IDLE_SELECTION,
    );
  });

  test("leaves a valid selection untouched", () => {
    const selection: ChartSelection = { scrubIndex: 1, pinA: 0, pinB: 2 };

    expect(clampSelection(selection, 3)).toEqual(selection);
  });
});

describe("selectionResetKey", () => {
  const base = INITIAL_VIEW_STATE;
  const key = selectionResetKey(base);

  test("range, granularity, metric and scope each clear the selection", () => {
    for (const change of [
      { rangeKey: "3M" as const },
      { granularity: "weekly" as const },
      { metric: "cost_basis" as const },
      { instrumentId: "goog" },
      { accountId: "brokerage" },
      { customRange: { start: "2026-01-01", end: "2026-02-01" } },
      // Same metric, different query mode — index 3 stops meaning what it
      // meant, so the pins go with it.
      { cumulative: true },
    ]) {
      expect(selectionResetKey({ ...base, ...change })).not.toBe(key);
    }
  });

  test("switching the list tab leaves the chart alone", () => {
    const onAccountsTab: ViewState = { ...base, tab: "accounts" };

    expect(selectionResetKey(onAccountsTab)).toBe(key);
  });

  test("an unchanged state is an unchanged key", () => {
    expect(selectionResetKey({ ...base })).toBe(key);
  });

  test("a null granularity is distinguishable from an explicit one", () => {
    // Guards the join: "auto" and a real granularity must not collide,
    // and neither must two adjacent fields running together.
    expect(selectionResetKey({ ...base, granularity: "daily" })).not.toBe(
      selectionResetKey({ ...base, granularity: null }),
    );
    expect(
      selectionResetKey({ ...base, metric: "equity", rangeKey: "1W" }),
    ).not.toBe(selectionResetKey({ ...base, metric: "equity", rangeKey: "1Y" }));
  });
});

describe("chartHint", () => {
  test("says what the current mode can do next", () => {
    expect(chartHint(IDLE_SELECTION)).toMatch(/drag/i);
    expect(chartHint(IDLE_SELECTION)).toMatch(/tap to pin/i);
    expect(chartHint({ scrubIndex: 3, pinA: null, pinB: null })).toMatch(
      /scrub/i,
    );
    expect(chartHint({ scrubIndex: null, pinA: 3, pinB: null })).toMatch(
      /compare/i,
    );
    expect(chartHint({ scrubIndex: null, pinA: 3, pinB: 6 })).toMatch(
      /A → B/,
    );
  });

  test("every mode gets its own line — the hint is never static", () => {
    const hints = [
      IDLE_SELECTION,
      { scrubIndex: 3, pinA: null, pinB: null },
      { scrubIndex: null, pinA: 3, pinB: null },
      { scrubIndex: null, pinA: 3, pinB: 6 },
    ].map(chartHint);

    expect(new Set(hints).size).toBe(4);
  });
});
