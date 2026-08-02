import { describe, expect, test } from "bun:test";
import type { ChartPoint } from "@/lib/chart";
import {
  buildHeadline,
  firstError,
  listVisibility,
  resolveDashboardRange,
  toChartPoints,
} from "@/lib/dashboard";

const TODAY = new Date(2026, 7, 2); // 2 Aug 2026, local midnight

function pt(iso: string, value: number): ChartPoint {
  return { timestamp: new Date(`${iso}T00:00:00`), value };
}

describe("resolveDashboardRange — Max", () => {
  test("spans from the earliest transaction to today", () => {
    // The bug this guards against: the screen called resolveRange with no
    // `earliest`, so Max fell back to start = end = today. One point,
    // "+$0.00 +0.00%", granularity pinned to Daily, label still reading
    // "all time" (behaviour.md § Ranges and granularity).
    const range = resolveDashboardRange({
      rangeKey: "Max",
      customRange: null,
      granularity: null,
      today: TODAY,
      earliest: new Date(2024, 0, 15),
    });

    expect(range.startDate).toBe("2024-01-15");
    expect(range.endDate).toBe("2026-08-02");
    expect(range.spanDays).toBeGreaterThan(900);
    expect(range.key).toBe("Max");
  });

  test("the span, not the key's name, picks the granularity", () => {
    const range = resolveDashboardRange({
      rangeKey: "Max",
      customRange: null,
      granularity: null,
      today: TODAY,
      earliest: new Date(2024, 0, 15),
    });

    expect(range.granularity).toBe("monthly");
  });

  test("with no transactions at all it collapses to today, honestly", () => {
    // A portfolio with an empty ledger genuinely has no history. The
    // single point is right here; what was wrong was reaching it with a
    // ledger full of transactions.
    const range = resolveDashboardRange({
      rangeKey: "Max",
      customRange: null,
      granularity: null,
      today: TODAY,
      earliest: null,
    });

    expect(range.startDate).toBe("2026-08-02");
    expect(range.endDate).toBe("2026-08-02");
  });
});

describe("resolveDashboardRange — Custom", () => {
  test("uses the supplied bounds", () => {
    const range = resolveDashboardRange({
      rangeKey: "Custom",
      customRange: { start: "2025-03-01", end: "2025-09-30" },
      granularity: null,
      today: TODAY,
      earliest: null,
    });

    expect(range.startDate).toBe("2025-03-01");
    expect(range.endDate).toBe("2025-09-30");
    expect(range.key).toBe("Custom");
  });

  test("Custom without bounds renames itself, so the label cannot lie", () => {
    // The old guard charted 1Y while the label still said "custom range".
    const range = resolveDashboardRange({
      rangeKey: "Custom",
      customRange: null,
      granularity: null,
      today: TODAY,
      earliest: null,
    });

    expect(range.key).toBe("1Y");
    expect(range.startDate).toBe("2025-08-02");
  });
});

describe("resolveDashboardRange — endsToday", () => {
  test("a relative range ends today", () => {
    const range = resolveDashboardRange({
      rangeKey: "1M",
      customRange: null,
      granularity: null,
      today: TODAY,
      earliest: null,
    });

    expect(range.endsToday).toBe(true);
  });

  test("a Custom range ending in the past does not", () => {
    const range = resolveDashboardRange({
      rangeKey: "Custom",
      customRange: { start: "2025-03-01", end: "2025-09-30" },
      granularity: null,
      today: TODAY,
      earliest: null,
    });

    expect(range.endsToday).toBe(false);
  });

  test("a Custom range ending in the future still counts as ending today", () => {
    // There is no data past today, so today's value is the latest thing
    // that window contains.
    const range = resolveDashboardRange({
      rangeKey: "Custom",
      customRange: { start: "2026-01-01", end: "2026-12-31" },
      granularity: null,
      today: TODAY,
      earliest: null,
    });

    expect(range.endsToday).toBe(true);
  });
});

describe("resolveDashboardRange — granularity", () => {
  test("an explicit choice the span can fill is kept", () => {
    const range = resolveDashboardRange({
      rangeKey: "1Y",
      customRange: null,
      granularity: "weekly",
      today: TODAY,
      earliest: null,
    });

    expect(range.granularity).toBe("weekly");
  });

  test("an explicit choice too coarse for the span falls back to the default", () => {
    const range = resolveDashboardRange({
      rangeKey: "1W",
      customRange: null,
      granularity: "monthly",
      today: TODAY,
      earliest: null,
    });

    expect(range.granularity).toBe("daily");
  });
});

describe("toChartPoints", () => {
  test("parses the first series' string decimals at local midnight", () => {
    const points = toChartPoints([
      {
        group: "total",
        points: [
          { timestamp: "2026-01-01", value: "1000.50" },
          { timestamp: "2026-02-01", value: "1200" },
        ],
      },
    ]);

    expect(points.map((p) => p.value)).toEqual([1000.5, 1200]);
    // Local midnight, not the UTC instant — which can land on Dec 31.
    expect(points[0].timestamp.getDate()).toBe(1);
    expect(points[0].timestamp.getMonth()).toBe(0);
  });

  test("no series is no points", () => {
    expect(toChartPoints(undefined)).toEqual([]);
    expect(toChartPoints([])).toEqual([]);
  });
});

describe("buildHeadline — Level metrics", () => {
  test("the figure is the last point and the delta spans the range", () => {
    const headline = buildHeadline({
      metric: "equity",
      cumulative: false,
      points: [pt("2026-01-01", 1000), pt("2026-06-01", 1300)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.value).toBe("$1,300.00");
    expect(headline.delta).toBe("+$300.00  +30.00%");
    expect(headline.rising).toBe(true);
  });

  test("a share-count delta is a count, not dollars", () => {
    // The bug this guards against: the delta line used the USD-only
    // formatter while the headline above it used the per-metric one, so
    // 10 shares -> 15 read "15" over "+$5.00".
    const headline = buildHeadline({
      metric: "share_count",
      cumulative: false,
      points: [pt("2026-01-01", 10), pt("2026-06-01", 15)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.value).toBe("15");
    expect(headline.delta).toBe("+5  +50.00%");
  });

  test("a fall is signed and coloured down", () => {
    const headline = buildHeadline({
      metric: "equity",
      cumulative: false,
      points: [pt("2026-01-01", 1000), pt("2026-06-01", 750)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.delta).toBe("−$250.00  −25.00%");
    expect(headline.rising).toBe(false);
  });

  test("a zero opening drops the percentage rather than fabricating one", () => {
    const headline = buildHeadline({
      metric: "equity",
      cumulative: false,
      points: [pt("2026-01-01", 0), pt("2026-06-01", 500)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.delta).toBe("+$500.00");
  });

  test("an empty series reads as zero rather than NaN", () => {
    const headline = buildHeadline({
      metric: "equity",
      cumulative: false,
      points: [],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.value).toBe("$0.00");
    expect(headline.delta).toBe("+$0.00");
  });
});

describe("buildHeadline — the one Flow", () => {
  test("per-period sums the buckets and counts them", () => {
    const headline = buildHeadline({
      metric: "realized_gain",
      cumulative: false,
      points: [pt("2026-01-31", 300), pt("2026-02-28", 200)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.value).toBe("+$500.00");
    expect(headline.delta).toBe("2 month buckets");
    expect(headline.rising).toBe(true);
  });

  test("cumulative reads the last bucket, which is already the total", () => {
    const headline = buildHeadline({
      metric: "realized_gain",
      cumulative: true,
      points: [pt("2026-01-31", 300), pt("2026-02-28", 500)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.value).toBe("+$500.00");
  });

  test("a Flow never shows a percentage — one against its first bucket says nothing", () => {
    const headline = buildHeadline({
      metric: "realized_gain",
      cumulative: false,
      points: [pt("2026-01-31", 300), pt("2026-02-28", 200)],
      granularity: "monthly",
      rangeKey: "1Y",
    });

    expect(headline.delta).not.toContain("%");
  });

  test("a net loss is coloured down", () => {
    const headline = buildHeadline({
      metric: "realized_gain",
      cumulative: false,
      points: [pt("2026-01-31", 300), pt("2026-02-28", -800)],
      granularity: "weekly",
      rangeKey: "1Y",
    });

    expect(headline.value).toBe("−$500.00");
    expect(headline.rising).toBe(false);
    expect(headline.delta).toBe("2 week buckets");
  });
});

describe("listVisibility", () => {
  test("exactly one list is on screen at every level", () => {
    const cases = [
      listVisibility("portfolio", "holdings"),
      listVisibility("portfolio", "accounts"),
      listVisibility("account", "holdings"),
      listVisibility("instrument", "holdings"),
      listVisibility("slice", "holdings"),
    ];

    for (const visible of cases) {
      expect(Object.values(visible).filter(Boolean)).toHaveLength(1);
    }
  });

  test("the tab only matters at the portfolio level", () => {
    expect(listVisibility("portfolio", "accounts").accounts).toBe(true);
    // A narrower level has exactly one list; a stale tab must not
    // resurrect the Accounts query there.
    expect(listVisibility("account", "accounts").accounts).toBe(false);
    expect(listVisibility("account", "accounts").holdings).toBe(true);
  });

  test("the instrument level shows the breakdown, the slice does not", () => {
    expect(listVisibility("instrument", "holdings").breakdown).toBe(true);
    expect(listVisibility("slice", "holdings").breakdown).toBe(false);
  });
});

describe("firstError", () => {
  test("returns the first message present", () => {
    expect(firstError([undefined, null, "boom", "later"])).toBe("boom");
  });

  test("no messages is null, not undefined", () => {
    expect(firstError([undefined, null])).toBeNull();
    expect(firstError([])).toBeNull();
  });
});

describe("buildHeadline — the caption", () => {
  test("at rest it names the range, so the delta and its window agree", () => {
    const headline = buildHeadline({
      metric: "equity",
      cumulative: false,
      points: [pt("2026-01-01", 1000), pt("2026-06-01", 1300)],
      granularity: "monthly",
      rangeKey: "Max",
    });

    expect(headline.caption).toBe("all time");
  });
});

describe("buildHeadline — scrub, pin and compare on a Level", () => {
  // Four monthly points, so every figure below is arithmetic a reader can
  // check in their head.
  const points = [
    pt("2026-01-01", 1000),
    pt("2026-02-01", 1200),
    pt("2026-03-01", 900),
    pt("2026-04-01", 1500),
  ];
  const headline = (selection: {
    scrubIndex: number | null;
    pinA: number | null;
    pinB: number | null;
  }) =>
    buildHeadline({
      metric: "equity",
      cumulative: false,
      points,
      granularity: "monthly",
      rangeKey: "1Y",
      selection,
    });

  test("scrubbing reads that point's value, its move from the previous one, and its date", () => {
    const scrubbed = headline({ scrubIndex: 2, pinA: null, pinB: null });

    expect(scrubbed.value).toBe("$900.00");
    expect(scrubbed.delta).toBe("−$300.00 vs prev");
    expect(scrubbed.caption).toBe("Mar 2026 · −$100.00 from start");
    expect(scrubbed.rising).toBe(false);
  });

  test("scrubbing the first point compares it with itself rather than reading off the end", () => {
    const scrubbed = headline({ scrubIndex: 0, pinA: null, pinB: null });

    expect(scrubbed.value).toBe("$1,000.00");
    expect(scrubbed.delta).toBe("+$0.00 vs prev");
    expect(scrubbed.caption).toBe("Jan 2026 · +$0.00 from start");
  });

  test("a pin reads the change from the start of the range and invites a second tap", () => {
    const pinned = headline({ scrubIndex: null, pinA: 1, pinB: null });

    expect(pinned.value).toBe("$1,200.00");
    expect(pinned.delta).toBe("+$200.00");
    expect(pinned.caption).toBe("Feb 2026 · pinned · tap another point to compare");
    expect(pinned.rising).toBe(true);
  });

  test("compare is the A→B delta and percent, labelled with both dates", () => {
    const compared = headline({ scrubIndex: null, pinA: 1, pinB: 3 });

    expect(compared.value).toBe("$1,500.00");
    expect(compared.delta).toBe("+$300.00  +25.00%");
    expect(compared.caption).toBe("Feb 2026 → Apr 2026");
    expect(compared.rising).toBe(true);
  });

  test("compare reads the same either way round, and always forwards in time", () => {
    // The prototype takes its big figure from B literally, so pinning
    // right-to-left showed the *start* of the span it had just captioned
    // in date order. Sorted, both tap orders agree.
    expect(headline({ scrubIndex: null, pinA: 3, pinB: 1 })).toEqual(
      headline({ scrubIndex: null, pinA: 1, pinB: 3 }),
    );
  });

  test("a fall between the two pins is signed and coloured down", () => {
    const compared = headline({ scrubIndex: null, pinA: 1, pinB: 2 });

    expect(compared.delta).toBe("−$300.00  −25.00%");
    expect(compared.rising).toBe(false);
  });

  test("a live scrub outranks the pins underneath it", () => {
    const scrubbed = headline({ scrubIndex: 0, pinA: 1, pinB: 3 });

    expect(scrubbed.value).toBe("$1,000.00");
    expect(scrubbed.caption).toContain("Jan 2026");
  });

  test("an index the series can no longer answer for falls back to the range summary", () => {
    // A refetch shortening the series must not index past the end and
    // render `$NaN`.
    const stale = headline({ scrubIndex: null, pinA: 9, pinB: null });

    expect(stale.value).toBe("$1,500.00");
    expect(stale.caption).toBe("past year");
  });

  test("a scrubbed share count is a count, not dollars", () => {
    const scrubbed = buildHeadline({
      metric: "share_count",
      cumulative: false,
      points: [pt("2026-01-01", 10), pt("2026-02-01", 15)],
      granularity: "monthly",
      rangeKey: "1Y",
      selection: { scrubIndex: 1, pinA: null, pinB: null },
    });

    expect(scrubbed.value).toBe("15");
    expect(scrubbed.delta).toBe("+5 vs prev");
  });
});

describe("buildHeadline — scrub, pin and compare on the one Flow", () => {
  // Per-period realized gain: each point is what that month booked.
  const points = [
    pt("2026-01-31", 300),
    pt("2026-02-28", -100),
    pt("2026-03-31", 500),
    pt("2026-04-30", 200),
  ];
  const headline = (
    selection: {
      scrubIndex: number | null;
      pinA: number | null;
      pinB: number | null;
    },
    cumulative = false,
    series = points,
  ) =>
    buildHeadline({
      metric: "realized_gain",
      cumulative,
      points: series,
      granularity: "monthly",
      rangeKey: "1Y",
      selection,
    });

  test("a scrubbed bucket reads what it booked, with no delta against its neighbour", () => {
    // "vs prev" and "from start" are both differences between two
    // independent bucket amounts — the same comparison behaviour.md rules
    // out for the headline percentage.
    const scrubbed = headline({ scrubIndex: 1, pinA: null, pinB: null });

    expect(scrubbed.value).toBe("−$100.00");
    expect(scrubbed.delta).toBe("booked this month");
    expect(scrubbed.caption).toBe("Feb 2026");
    expect(scrubbed.rising).toBe(false);
  });

  test("cumulative names the running total rather than the bucket", () => {
    const scrubbed = headline(
      { scrubIndex: 2, pinA: null, pinB: null },
      true,
      [pt("2026-01-31", 300), pt("2026-02-28", 200), pt("2026-03-31", 700)],
    );

    expect(scrubbed.value).toBe("+$700.00");
    expect(scrubbed.delta).toBe("booked to date");
  });

  test("a pinned bucket adds the invitation to compare", () => {
    const pinned = headline({ scrubIndex: null, pinA: 2, pinB: null });

    expect(pinned.value).toBe("+$500.00");
    expect(pinned.caption).toBe("Mar 2026 · pinned · tap another point to compare");
  });

  test("compare is the total booked between the two pins, never a percentage", () => {
    const compared = headline({ scrubIndex: null, pinA: 1, pinB: 3 });

    // −100 + 500 + 200, inclusive of both ends.
    expect(compared.value).toBe("+$600.00");
    expect(compared.delta).toBe("booked over 3 month buckets");
    expect(compared.caption).toBe("Feb 2026 → Apr 2026");
    expect(compared.delta).not.toContain("%");
  });

  test("the two Flow modes agree about the same pair of pins", () => {
    // Per-period and cumulative are the same gains described two ways, so
    // a window's total must not depend on which mode is on screen.
    const running = [
      pt("2026-01-31", 300),
      pt("2026-02-28", 200),
      pt("2026-03-31", 700),
      pt("2026-04-30", 900),
    ];

    expect(headline({ scrubIndex: null, pinA: 1, pinB: 3 }, true, running).value).toBe(
      headline({ scrubIndex: null, pinA: 1, pinB: 3 }).value,
    );
  });
});
