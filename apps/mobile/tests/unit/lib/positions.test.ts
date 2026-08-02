import { describe, expect, test } from "bun:test";
import {
  accountHoldsInstruments,
  addSeries,
  buildAccountRows,
  buildHoldingRows,
  buildInstrumentAccountRows,
  buildInstrumentStats,
  cashBalanceFor,
  changePercent,
  combineAccountSeries,
  pointsByGroup,
  rowChangePercent,
  splitClosed,
  type PositionRow,
} from "@/lib/positions";

const RANGE_START = "2026-01-01";

function position(overrides: Partial<PositionRow> = {}): PositionRow {
  return {
    account_id: "acc1",
    instrument_id: "goog",
    share_count: "10",
    cost_basis: "1000",
    average_cost: "100",
    market_value: "1300",
    realized_gain: "0",
    unrealized_gain: "300",
    ...overrides,
  };
}

const INSTRUMENTS = [
  { id: "goog", symbol: "GOOG", name: "Alphabet Inc", asset_class: "equity" },
  { id: "tsla", symbol: "TSLA", name: "Tesla Inc", asset_class: "equity" },
  { id: "cash", symbol: "USD", name: "Cash", asset_class: "cash" },
] as const;

const ACCOUNTS = [
  {
    id: "acc1",
    name: "Wells Fargo Brokerage",
    institution: "Wells Fargo",
    account_type: "brokerage",
  },
  {
    id: "acc2",
    name: "Cash Reserve",
    institution: "Ally",
    account_type: "cash",
  },
] as const;

describe("changePercent — the one range-percentage rule", () => {
  test("is signed against the magnitude of the opening value", () => {
    expect(changePercent(1000, 1300)).toBeCloseTo(30, 10);
    expect(changePercent(-100, -50)).toBeCloseTo(50, 10);
  });

  test("a zero opening has no percentage, not an infinite one", () => {
    expect(changePercent(0, 600)).toBeNull();
  });

  test("non-finite inputs have no percentage", () => {
    expect(changePercent(Number.NaN, 600)).toBeNull();
    expect(changePercent(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("rowChangePercent — the range-scoped row percentage", () => {
  function pct(
    currentValue: number | null,
    points: { timestamp: string; value: number }[] | undefined,
    rangeStart = RANGE_START,
    currentValueIsRangeEnd = true,
  ) {
    return rowChangePercent({
      currentValue,
      points,
      rangeStart,
      currentValueIsRangeEnd,
    });
  }

  test("measures the change from the range's opening value", () => {
    const points = [
      { timestamp: "2026-01-01", value: 1000 },
      { timestamp: "2026-02-01", value: 1200 },
    ];

    expect(pct(1300, points)).toBeCloseTo(30, 10);
  });

  test("is the current value, not the series' last point, that moves it", () => {
    // The value column comes from the positions endpoint; the series only
    // ever supplies the denominator.
    const points = [{ timestamp: "2026-01-01", value: 1000 }];

    expect(pct(900, points)).toBeCloseTo(-10, 10);
  });

  test("a range that does not end today has no percentage", () => {
    // The bug this guards against: /portfolio/positions takes no date, so
    // `currentValue` is always *today's*. On a Custom range ending in the
    // past the header measures first -> last while a row measured
    // rangeStart -> today — two percentages that look identical and mean
    // different things, which is exactly what behaviour.md § Percentages
    // was written to kill. A dash is the honest answer.
    const points = [
      { timestamp: "2026-01-01", value: 1000 },
      { timestamp: "2026-02-01", value: 1200 },
    ];

    expect(pct(1300, points, RANGE_START, false)).toBeNull();
  });

  test("a position opened inside the range has no percentage", () => {
    // The backend samples from the range start and only emits points from
    // a position's first activity — a later first point means it did not
    // exist at the start of the range.
    const points = [{ timestamp: "2026-03-01", value: 500 }];

    expect(pct(600, points)).toBeNull();
  });

  test("a dash, never a fabricated zero, for a position opened in range", () => {
    const points = [{ timestamp: "2026-03-01", value: 600 }];

    expect(pct(600, points)).not.toBe(0);
    expect(pct(600, points)).toBeNull();
  });

  test("an empty series has no percentage", () => {
    expect(pct(600, [])).toBeNull();
    expect(pct(600, undefined)).toBeNull();
  });

  test("a row with no current value has no percentage", () => {
    const points = [{ timestamp: "2026-01-01", value: 1000 }];

    expect(pct(null, points)).toBeNull();
  });

  test("a zero opening value has no percentage", () => {
    const points = [{ timestamp: "2026-01-01", value: 0 }];

    expect(pct(600, points)).toBeNull();
  });

  test("a series starting before the range start still counts as present", () => {
    // Nothing forbids an earlier first point; only a *later* one means
    // the position did not exist yet.
    const points = [{ timestamp: "2025-12-15", value: 200 }];

    expect(pct(300, points)).toBeCloseTo(50, 10);
  });

  test("percentages are signed against the magnitude of the opening value", () => {
    // Unrealized gain can open negative; a loss shrinking is still a rise.
    const points = [{ timestamp: "2026-01-01", value: -100 }];

    expect(pct(-50, points)).toBeCloseTo(50, 10);
  });

  test("the same row moves when the range moves", () => {
    // Each range gets its own query, so each gets its own series — the
    // shorter one simply starts later. Same holding, same current value,
    // different percentage: that is the whole point of range-scoping.
    const overOneYear = pct(
      1300,
      [{ timestamp: "2026-01-01", value: 1000 }],
      "2026-01-01",
    );
    const overTwoYears = pct(
      1300,
      [
        { timestamp: "2025-01-01", value: 500 },
        { timestamp: "2026-01-01", value: 1000 },
      ],
      "2025-01-01",
    );

    expect(overOneYear).toBeCloseTo(30, 10);
    expect(overTwoYears).toBeCloseTo(160, 10);
  });

  test("a series wider than the range opens at the range start, not at its own first point", () => {
    const points = [
      { timestamp: "2025-01-01", value: 500 },
      { timestamp: "2026-01-01", value: 1000 },
      { timestamp: "2026-06-01", value: 1100 },
    ];

    expect(pct(1300, points, "2026-01-01")).toBeCloseTo(30, 10);
  });
});

describe("pointsByGroup", () => {
  test("keys by group and parses the string decimals", () => {
    const grouped = pointsByGroup([
      { group: "goog", points: [{ timestamp: "2026-01-01", value: "12.50" }] },
    ]);

    expect(grouped.goog).toEqual([{ timestamp: "2026-01-01", value: 12.5 }]);
  });

  test("an absent response is an empty map, not a crash", () => {
    expect(pointsByGroup(undefined)).toEqual({});
  });
});

describe("addSeries", () => {
  test("adds pointwise on matching timestamps", () => {
    const sum = addSeries(
      [{ timestamp: "2026-01-01", value: 100 }],
      [{ timestamp: "2026-01-01", value: 40 }],
    );

    expect(sum).toEqual([{ timestamp: "2026-01-01", value: 140 }]);
  });

  test("a timestamp present in only one series keeps its value", () => {
    // An account with cash but no holdings genuinely had zero equity —
    // dropping the timestamp would lose the range-start sample.
    const sum = addSeries(
      [{ timestamp: "2026-02-01", value: 100 }],
      [
        { timestamp: "2026-01-01", value: 40 },
        { timestamp: "2026-02-01", value: 40 },
      ],
    );

    expect(sum).toEqual([
      { timestamp: "2026-01-01", value: 40 },
      { timestamp: "2026-02-01", value: 140 },
    ]);
  });

  test("results stay in chronological order", () => {
    const sum = addSeries(
      [
        { timestamp: "2026-03-01", value: 1 },
        { timestamp: "2026-01-01", value: 1 },
      ],
      [{ timestamp: "2026-02-01", value: 1 }],
    );

    expect(sum.map((p) => p.timestamp)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });
});

describe("combineAccountSeries", () => {
  test("adds equity and cash per account, over the union of both", () => {
    const combined = combineAccountSeries(
      { acc1: [{ timestamp: "2026-01-01", value: 1000 }] },
      {
        acc1: [{ timestamp: "2026-01-01", value: 250 }],
        acc2: [{ timestamp: "2026-01-01", value: 500 }],
      },
    );

    expect(combined.acc1).toEqual([{ timestamp: "2026-01-01", value: 1250 }]);
    // A cash-only account has no equity series at all and must still get
    // a row — that is the Accounts tab's whole point.
    expect(combined.acc2).toEqual([{ timestamp: "2026-01-01", value: 500 }]);
  });

  test("an account with equity but no cash still combines", () => {
    const combined = combineAccountSeries(
      { acc1: [{ timestamp: "2026-01-01", value: 1000 }] },
      {},
    );

    expect(combined.acc1).toEqual([{ timestamp: "2026-01-01", value: 1000 }]);
  });
});

describe("buildHoldingRows", () => {
  test("sums a single instrument held across two accounts", () => {
    const rows = buildHoldingRows({
      positions: [
        position({ account_id: "acc1", share_count: "10", market_value: "1300" }),
        position({ account_id: "acc2", share_count: "5", market_value: "650" }),
      ],
      instruments: INSTRUMENTS,
      pointsByInstrument: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].shareCount).toBe(15);
    expect(rows[0].marketValue).toBe(1950);
    expect(rows[0].symbol).toBe("GOOG");
    expect(rows[0].name).toBe("Alphabet Inc");
  });

  test("the CASH instrument never becomes a holdings row", () => {
    const rows = buildHoldingRows({
      positions: [
        position(),
        position({ instrument_id: "cash", share_count: "9000", market_value: "9000" }),
      ],
      instruments: INSTRUMENTS,
      pointsByInstrument: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.map((r) => r.instrumentId)).toEqual(["goog"]);
  });

  test("largest market value first", () => {
    const rows = buildHoldingRows({
      positions: [
        position({ instrument_id: "goog", market_value: "100" }),
        position({ instrument_id: "tsla", market_value: "900" }),
      ],
      instruments: INSTRUMENTS,
      pointsByInstrument: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.map((r) => r.instrumentId)).toEqual(["tsla", "goog"]);
  });

  test("an unpriced instrument keeps a null market value rather than zero", () => {
    const rows = buildHoldingRows({
      positions: [position({ instrument_id: "tsla", market_value: null })],
      instruments: INSTRUMENTS,
      pointsByInstrument: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows[0].marketValue).toBeNull();
    expect(rows[0].changePercent).toBeNull();
  });

  test("the row percentage is taken against that instrument's own series", () => {
    const rows = buildHoldingRows({
      positions: [position({ instrument_id: "goog", market_value: "1300" })],
      instruments: INSTRUMENTS,
      pointsByInstrument: {
        goog: [{ timestamp: "2026-01-01", value: 1000 }],
        tsla: [{ timestamp: "2026-01-01", value: 1 }],
      },
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows[0].changePercent).toBeCloseTo(30, 10);
  });

  test("a range that does not end today dashes every row percentage", () => {
    // The positions endpoint has no date parameter, so `market_value` is
    // always today's. Measuring it against a window that closed months
    // ago would put a number beside the header that means something else
    // (behaviour.md § Percentages).
    const rows = buildHoldingRows({
      positions: [position({ instrument_id: "goog", market_value: "1300" })],
      instruments: INSTRUMENTS,
      pointsByInstrument: {
        goog: [{ timestamp: "2026-01-01", value: 1000 }],
      },
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: false,
    });

    expect(rows[0].marketValue).toBe(1300);
    expect(rows[0].changePercent).toBeNull();
  });

  test("a closed position keeps its realized gain", () => {
    const rows = buildHoldingRows({
      positions: [
        position({
          instrument_id: "tsla",
          share_count: "0",
          cost_basis: "0",
          market_value: "0",
          realized_gain: "3420",
        }),
      ],
      instruments: INSTRUMENTS,
      pointsByInstrument: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows[0].shareCount).toBe(0);
    expect(rows[0].realizedGain).toBe(3420);
  });
});

describe("buildAccountRows", () => {
  test("an account's value includes its cash", () => {
    const rows = buildAccountRows({
      positions: [
        position({ account_id: "acc1", market_value: "1300" }),
        position({ account_id: "acc1", instrument_id: "cash", market_value: "700" }),
      ],
      accounts: ACCOUNTS,
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.find((r) => r.accountId === "acc1")?.value).toBe(2000);
  });

  test("an account with no transactions still gets a row, valued at zero", () => {
    const rows = buildAccountRows({
      positions: [position({ account_id: "acc1", market_value: "1300" })],
      accounts: ACCOUNTS,
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.map((r) => r.accountId).sort()).toEqual(["acc1", "acc2"]);
    expect(rows.find((r) => r.accountId === "acc2")?.value).toBe(0);
  });

  test("the account type is labelled, not spelled as the enum", () => {
    const rows = buildAccountRows({
      positions: [],
      accounts: ACCOUNTS,
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.find((r) => r.accountId === "acc1")?.accountType).toBe(
      "Taxable brokerage",
    );
    expect(rows.find((r) => r.accountId === "acc2")?.accountType).toBe("Cash only");
  });

  test("an account holding one unpriced instrument has no value yet", () => {
    const rows = buildAccountRows({
      positions: [
        position({ account_id: "acc1", market_value: null }),
        position({ account_id: "acc1", instrument_id: "cash", market_value: "700" }),
      ],
      accounts: ACCOUNTS,
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.find((r) => r.accountId === "acc1")?.value).toBeNull();
  });

  test("the row percentage uses the account's own combined series", () => {
    const rows = buildAccountRows({
      positions: [position({ account_id: "acc1", market_value: "1200" })],
      accounts: ACCOUNTS,
      pointsByAccount: {
        acc1: [{ timestamp: "2026-01-01", value: 1000 }],
      },
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.find((r) => r.accountId === "acc1")?.changePercent).toBeCloseTo(
      20,
      10,
    );
  });
});

describe("splitClosed", () => {
  test("zero-share rows are separated from live ones", () => {
    const { live, closed } = splitClosed([
      { shareCount: 10, realizedGain: 0, id: "a" },
      { shareCount: 0, realizedGain: 120, id: "b" },
      { shareCount: 0.5, realizedGain: 0, id: "c" },
    ]);

    expect(live.map((r) => r.id)).toEqual(["a", "c"]);
    expect(closed.map((r) => r.id)).toEqual(["b"]);
  });

  test("a round trip at cost is neither live nor closed", () => {
    // #16 scopes the closed disclosure to "share count zero, *but with
    // realized gain*". Bought and sold at the same price books exactly
    // nothing, so filing it under "Closed positions · 1 … realized
    // +$0.00" advertises a row with nothing to say.
    const { live, closed } = splitClosed([
      { shareCount: 10, realizedGain: 0, id: "a" },
      { shareCount: 0, realizedGain: 0, id: "flat" },
    ]);

    expect(live.map((r) => r.id)).toEqual(["a"]);
    expect(closed).toEqual([]);
  });

  test("a realized loss still counts as closed", () => {
    const { closed } = splitClosed([{ shareCount: 0, realizedGain: -80, id: "l" }]);

    expect(closed.map((r) => r.id)).toEqual(["l"]);
  });
});

describe("buildInstrumentAccountRows — the instrument level's breakdown", () => {
  test("one row per account that has held the instrument", () => {
    const rows = buildInstrumentAccountRows({
      positions: [
        position({ account_id: "acc1", market_value: "1300" }),
        position({ account_id: "acc2", market_value: "2600" }),
        position({ account_id: "acc1", instrument_id: "tsla" }),
      ],
      accounts: ACCOUNTS,
      instrumentId: "goog",
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows.map((r) => r.accountId)).toEqual(["acc2", "acc1"]);
    expect(rows[0].name).toBe("Cash Reserve");
  });

  test("accounts that never held it are absent, not zero rows", () => {
    // The opposite of buildAccountRows: an unfunded account is a real
    // thing you own, but an account that never touched GOOG is not part
    // of your GOOG position.
    const rows = buildInstrumentAccountRows({
      positions: [position({ account_id: "acc1" })],
      accounts: ACCOUNTS,
      instrumentId: "goog",
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows).toHaveLength(1);
  });

  test("each row's percentage comes from its own account's series", () => {
    const rows = buildInstrumentAccountRows({
      positions: [position({ account_id: "acc1", market_value: "1500" })],
      accounts: ACCOUNTS,
      instrumentId: "goog",
      pointsByAccount: { acc1: [{ timestamp: "2026-01-01", value: 1000 }] },
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows[0].changePercent).toBeCloseTo(50, 10);
  });

  test("a closed row keeps its realized gain and reports no average cost", () => {
    const rows = buildInstrumentAccountRows({
      positions: [
        position({
          share_count: "0",
          cost_basis: "0",
          average_cost: null,
          market_value: "0",
          realized_gain: "3420",
          unrealized_gain: "0",
        }),
      ],
      accounts: ACCOUNTS,
      instrumentId: "goog",
      pointsByAccount: {},
      rangeStart: RANGE_START,
      currentValueIsRangeEnd: true,
    });

    expect(rows[0].shareCount).toBe(0);
    expect(rows[0].averageCost).toBeNull();
    expect(rows[0].realizedGain).toBe(3420);
  });
});

describe("buildInstrumentStats — the six-field stat card", () => {
  test("sums across every account holding the instrument", () => {
    const stats = buildInstrumentStats(
      [
        position({
          account_id: "acc1",
          share_count: "10",
          cost_basis: "1000",
          market_value: "1300",
          realized_gain: "50",
          unrealized_gain: "300",
        }),
        position({
          account_id: "acc2",
          share_count: "30",
          cost_basis: "3600",
          market_value: "3900",
          realized_gain: "0",
          unrealized_gain: "300",
        }),
        position({ account_id: "acc1", instrument_id: "tsla" }),
      ],
      "goog",
    );

    expect(stats.shareCount).toBe(40);
    expect(stats.costBasis).toBe(4600);
    expect(stats.marketValue).toBe(5200);
    expect(stats.realizedGain).toBe(50);
    expect(stats.unrealizedGain).toBe(600);
  });

  test("market price is market value over shares — exactly the close", () => {
    const stats = buildInstrumentStats(
      [position({ share_count: "10", market_value: "1300" })],
      "goog",
    );

    expect(stats.marketPrice).toBeCloseTo(130, 10);
  });

  test("average cost is cost basis over shares", () => {
    const stats = buildInstrumentStats(
      [position({ share_count: "40", cost_basis: "6000" })],
      "goog",
    );

    expect(stats.averageCost).toBeCloseTo(150, 10);
  });

  test("a fully closed position has neither a market price nor an average cost", () => {
    // Both are a division by zero shares. A $0 would read as a real
    // price, which is worse than a dash.
    const stats = buildInstrumentStats(
      [
        position({
          share_count: "0",
          cost_basis: "0",
          average_cost: null,
          market_value: "0",
          realized_gain: "3420",
        }),
      ],
      "goog",
    );

    expect(stats.marketPrice).toBeNull();
    expect(stats.averageCost).toBeNull();
    expect(stats.realizedGain).toBe(3420);
  });

  test("one unpriced account makes the whole card's value pending, not zero", () => {
    const stats = buildInstrumentStats(
      [
        position({ account_id: "acc1", market_value: "1300", unrealized_gain: "300" }),
        position({ account_id: "acc2", market_value: null, unrealized_gain: null }),
      ],
      "goog",
    );

    expect(stats.marketValue).toBeNull();
    expect(stats.marketPrice).toBeNull();
    expect(stats.unrealizedGain).toBeNull();
  });
});

describe("cashBalanceFor", () => {
  test("reads the account's CASH position, which is priced at exactly 1", () => {
    const balance = cashBalanceFor({
      positions: [
        position({ account_id: "acc2", instrument_id: "cash", market_value: "53000" }),
        position({ account_id: "acc1", instrument_id: "cash", market_value: "10" }),
      ],
      instruments: INSTRUMENTS,
      accountId: "acc2",
    });

    expect(balance).toBe(53000);
  });

  test("an account that has never held cash has none, not zero", () => {
    expect(
      cashBalanceFor({
        positions: [position({ account_id: "acc1" })],
        instruments: INSTRUMENTS,
        accountId: "acc1",
      }),
    ).toBeNull();
  });

  test("cash is found by asset class, not by the well-known id", () => {
    const balance = cashBalanceFor({
      positions: [
        position({ account_id: "acc1", instrument_id: "usd", market_value: "42" }),
      ],
      instruments: [
        { id: "usd", symbol: "USD", name: "Dollars", asset_class: "cash" },
      ],
      accountId: "acc1",
    });

    expect(balance).toBe(42);
  });
});

describe("accountHoldsInstruments — auto-adjustment 1's predicate", () => {
  test("a cash-only account holds nothing", () => {
    expect(
      accountHoldsInstruments({
        positions: [
          position({ account_id: "acc2", instrument_id: "cash", market_value: "53000" }),
        ],
        instruments: INSTRUMENTS,
        accountId: "acc2",
      }),
    ).toBe(false);
  });

  test("a live equity position counts", () => {
    expect(
      accountHoldsInstruments({
        positions: [position({ account_id: "acc1" })],
        instruments: INSTRUMENTS,
        accountId: "acc1",
      }),
    ).toBe(true);
  });

  test("a fully closed position does not count", () => {
    // Zero shares chart as a flat zero under every holdings metric —
    // exactly the blank the auto-adjustment exists to avoid.
    expect(
      accountHoldsInstruments({
        positions: [
          position({ account_id: "acc1", share_count: "0", realized_gain: "3420" }),
        ],
        instruments: INSTRUMENTS,
        accountId: "acc1",
      }),
    ).toBe(false);
  });

  test("another account's holdings don't count", () => {
    expect(
      accountHoldsInstruments({
        positions: [position({ account_id: "acc1" })],
        instruments: INSTRUMENTS,
        accountId: "acc2",
      }),
    ).toBe(false);
  });
});
