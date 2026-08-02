import { describe, expect, test } from "bun:test";
import {
  accountHoldsInstruments,
  addSeries,
  buildAccountRows,
  buildHoldingRows,
  buildInstrumentAccountRows,
  buildInstrumentStats,
  cashBalanceFor,
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

describe("rowChangePercent — the range-scoped row percentage", () => {
  test("measures the change from the range's opening value", () => {
    const points = [
      { timestamp: "2026-01-01", value: 1000 },
      { timestamp: "2026-02-01", value: 1200 },
    ];

    expect(rowChangePercent(1300, points, RANGE_START)).toBeCloseTo(30, 10);
  });

  test("is the current value, not the series' last point, that moves it", () => {
    // The value column comes from the positions endpoint; the series only
    // ever supplies the denominator.
    const points = [{ timestamp: "2026-01-01", value: 1000 }];

    expect(rowChangePercent(900, points, RANGE_START)).toBeCloseTo(-10, 10);
  });

  test("a position opened inside the range has no percentage", () => {
    // The backend samples from the range start and only emits points from
    // a position's first activity — a later first point means it did not
    // exist at the start of the range.
    const points = [{ timestamp: "2026-03-01", value: 500 }];

    expect(rowChangePercent(600, points, RANGE_START)).toBeNull();
  });

  test("a dash, never a fabricated zero, for a position opened in range", () => {
    const points = [{ timestamp: "2026-03-01", value: 600 }];

    expect(rowChangePercent(600, points, RANGE_START)).not.toBe(0);
    expect(rowChangePercent(600, points, RANGE_START)).toBeNull();
  });

  test("an empty series has no percentage", () => {
    expect(rowChangePercent(600, [], RANGE_START)).toBeNull();
    expect(rowChangePercent(600, undefined, RANGE_START)).toBeNull();
  });

  test("a row with no current value has no percentage", () => {
    const points = [{ timestamp: "2026-01-01", value: 1000 }];

    expect(rowChangePercent(null, points, RANGE_START)).toBeNull();
  });

  test("a zero opening value has no percentage", () => {
    const points = [{ timestamp: "2026-01-01", value: 0 }];

    expect(rowChangePercent(600, points, RANGE_START)).toBeNull();
  });

  test("a series starting before the range start still counts as present", () => {
    // Nothing forbids an earlier first point; only a *later* one means
    // the position did not exist yet.
    const points = [{ timestamp: "2025-12-15", value: 200 }];

    expect(rowChangePercent(300, points, RANGE_START)).toBeCloseTo(50, 10);
  });

  test("percentages are signed against the magnitude of the opening value", () => {
    // Unrealized gain can open negative; a loss shrinking is still a rise.
    const points = [{ timestamp: "2026-01-01", value: -100 }];

    expect(rowChangePercent(-50, points, RANGE_START)).toBeCloseTo(50, 10);
  });

  test("the same row moves when the range moves", () => {
    // Each range gets its own query, so each gets its own series — the
    // shorter one simply starts later. Same holding, same current value,
    // different percentage: that is the whole point of range-scoping.
    const overOneYear = rowChangePercent(
      1300,
      [{ timestamp: "2026-01-01", value: 1000 }],
      "2026-01-01",
    );
    const overTwoYears = rowChangePercent(
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

    expect(rowChangePercent(1300, points, "2026-01-01")).toBeCloseTo(30, 10);
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
    });

    expect(rows.map((r) => r.instrumentId)).toEqual(["tsla", "goog"]);
  });

  test("an unpriced instrument keeps a null market value rather than zero", () => {
    const rows = buildHoldingRows({
      positions: [position({ instrument_id: "tsla", market_value: null })],
      instruments: INSTRUMENTS,
      pointsByInstrument: {},
      rangeStart: RANGE_START,
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
    });

    expect(rows[0].changePercent).toBeCloseTo(30, 10);
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
    });

    expect(rows.find((r) => r.accountId === "acc1")?.value).toBe(2000);
  });

  test("an account with no transactions still gets a row, valued at zero", () => {
    const rows = buildAccountRows({
      positions: [position({ account_id: "acc1", market_value: "1300" })],
      accounts: ACCOUNTS,
      pointsByAccount: {},
      rangeStart: RANGE_START,
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
      { shareCount: 10, id: "a" },
      { shareCount: 0, id: "b" },
      { shareCount: 0.5, id: "c" },
    ]);

    expect(live.map((r) => r.id)).toEqual(["a", "c"]);
    expect(closed.map((r) => r.id)).toEqual(["b"]);
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
