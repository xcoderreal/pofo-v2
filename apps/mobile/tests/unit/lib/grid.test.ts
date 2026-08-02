import { describe, expect, test } from "bun:test";
import {
  buildAllocation,
  buildGridTotal,
  buildMatrix,
} from "@/lib/grid";
import type { AccountRow, PositionRow } from "@/lib/positions";

const RANGE_START = "2025-08-02";

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
  { id: "voo", symbol: "VOO", name: "Vanguard S&P 500", asset_class: "etf" },
  { id: "tsla", symbol: "TSLA", name: "Tesla Inc", asset_class: "equity" },
  { id: "cash", symbol: "USD", name: "Cash", asset_class: "cash" },
] as const;

const ACCOUNTS = [
  {
    id: "acc1",
    name: "Brokerage",
    institution: "Wells Fargo",
    account_type: "brokerage",
  },
  { id: "acc2", name: "IRA", institution: "Wells Fargo", account_type: "ira" },
  {
    id: "reserve",
    name: "Cash Reserve",
    institution: "Ally",
    account_type: "cash",
  },
] as const;

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    accountId: "acc1",
    name: "Brokerage",
    accountType: "Taxable brokerage",
    value: 1000,
    changePercent: null,
    ...overrides,
  };
}

// ─── Total tile ───────────────────────────────────────────────

describe("buildGridTotal — equity plus cash, non-overlapping", () => {
  test("sums every position row, cash included, exactly once", () => {
    const total = buildGridTotal({
      positions: [
        position({ instrument_id: "goog", market_value: "25000" }),
        position({ instrument_id: "voo", market_value: "40000" }),
        // The CASH leg trades auto-post — its market value *is* the
        // balance (ADR-0001 § 2), so no separate cash query is needed.
        position({ instrument_id: "cash", market_value: "8000" }),
      ],
      points: undefined,
      rangeStart: RANGE_START,
    });

    expect(total.value).toBe(73_000);
  });

  test("measures the change from the series' opening value", () => {
    const total = buildGridTotal({
      positions: [position({ market_value: "12000" })],
      points: [
        { timestamp: RANGE_START, value: 10_000 },
        { timestamp: "2026-01-01", value: 11_000 },
      ],
      rangeStart: RANGE_START,
    });

    expect(total.change).toBe(2000);
    expect(total.changePercent).toBeCloseTo(20, 10);
  });

  test("has no change figure when the range opens before the portfolio does", () => {
    const total = buildGridTotal({
      positions: [position({ market_value: "12000" })],
      points: [{ timestamp: "2026-01-01", value: 11_000 }],
      rangeStart: RANGE_START,
    });

    expect(total.value).toBe(12_000);
    expect(total.change).toBeNull();
    expect(total.changePercent).toBeNull();
  });

  test("is null while any holding is unpriced, rather than a partial sum", () => {
    const total = buildGridTotal({
      positions: [
        position({ instrument_id: "goog", market_value: "25000" }),
        position({ instrument_id: "voo", market_value: null }),
      ],
      points: [{ timestamp: RANGE_START, value: 10_000 }],
      rangeStart: RANGE_START,
    });

    expect(total.value).toBeNull();
    expect(total.change).toBeNull();
    expect(total.changePercent).toBeNull();
  });
});

// ─── Allocation bar ───────────────────────────────────────────

describe("buildAllocation", () => {
  test("one segment per account, percentages summing to 100", () => {
    const segments = buildAllocation([
      accountRow({ accountId: "acc1", name: "Brokerage", value: 6000 }),
      accountRow({ accountId: "acc2", name: "IRA", value: 3000 }),
      accountRow({ accountId: "reserve", name: "Cash Reserve", value: 1000 }),
    ]);

    expect(segments.map((s) => s.accountId)).toEqual([
      "acc1",
      "acc2",
      "reserve",
    ]);
    expect(segments.map((s) => s.percent)).toEqual([60, 30, 10]);
    expect(segments.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100, 10);
  });

  test("sorts by value regardless of the order it is handed", () => {
    const segments = buildAllocation([
      accountRow({ accountId: "small", value: 100 }),
      accountRow({ accountId: "big", value: 900 }),
    ]);

    expect(segments.map((s) => s.accountId)).toEqual(["big", "small"]);
  });

  test("excludes dust and unpriced accounts, and renormalises", () => {
    const segments = buildAllocation([
      accountRow({ accountId: "acc1", value: 750 }),
      accountRow({ accountId: "acc2", value: 250 }),
      // Rounding dust — a zero-width segment and a "0%" legend entry.
      accountRow({ accountId: "dust", value: 0.4 }),
      // Unknown value: counting it as zero would inflate everyone else's
      // share while pretending to be exact.
      accountRow({ accountId: "unpriced", value: null }),
    ]);

    expect(segments.map((s) => s.accountId)).toEqual(["acc1", "acc2"]);
    expect(segments.map((s) => s.percent)).toEqual([75, 25]);
  });

  test("is empty rather than dividing by zero for an empty portfolio", () => {
    expect(buildAllocation([])).toEqual([]);
    expect(buildAllocation([accountRow({ value: 0 })])).toEqual([]);
  });
});

// ─── The matrix ───────────────────────────────────────────────

describe("buildMatrix — membership rules", () => {
  test("a column for every account holding an instrument, and none for the rest", () => {
    const { columns } = buildMatrix({
      positions: [
        position({ account_id: "acc1", instrument_id: "goog", market_value: "500" }),
        position({ account_id: "acc2", instrument_id: "voo", market_value: "900" }),
        // Cash-only: its column would be entirely dots.
        position({
          account_id: "reserve",
          instrument_id: "cash",
          market_value: "53000",
        }),
      ],
      instruments: INSTRUMENTS,
      accounts: ACCOUNTS,
    });

    expect(columns.map((c) => c.accountId)).toEqual(["acc2", "acc1"]);
    expect(columns.map((c) => c.label)).toEqual(["IRA", "Brokerage"]);
  });

  test("an account holding only a fully closed position gets no column", () => {
    const { columns, rows } = buildMatrix({
      positions: [
        position({ account_id: "acc1", instrument_id: "goog" }),
        position({
          account_id: "acc2",
          instrument_id: "tsla",
          share_count: "0",
          market_value: "0",
          realized_gain: "3420",
        }),
      ],
      instruments: INSTRUMENTS,
      accounts: ACCOUNTS,
    });

    expect(columns.map((c) => c.accountId)).toEqual(["acc1"]);
    expect(rows.map((r) => r.instrumentId)).toEqual(["goog"]);
  });

  test("CASH is never a row — it is the total tile's other half", () => {
    const { rows } = buildMatrix({
      positions: [
        position({ account_id: "acc1", instrument_id: "goog" }),
        position({
          account_id: "acc1",
          instrument_id: "cash",
          market_value: "9000",
        }),
      ],
      instruments: INSTRUMENTS,
      accounts: ACCOUNTS,
    });

    expect(rows.map((r) => r.instrumentId)).toEqual(["goog"]);
  });

  test("both axes sort by value, largest first", () => {
    const { columns, rows } = buildMatrix({
      positions: [
        position({ account_id: "acc1", instrument_id: "goog", market_value: "10" }),
        position({ account_id: "acc2", instrument_id: "goog", market_value: "50" }),
        position({ account_id: "acc2", instrument_id: "voo", market_value: "900" }),
      ],
      instruments: INSTRUMENTS,
      accounts: ACCOUNTS,
    });

    expect(columns.map((c) => c.accountId)).toEqual(["acc2", "acc1"]);
    expect(rows.map((r) => r.instrumentId)).toEqual(["voo", "goog"]);
  });
});

describe("buildMatrix — cells", () => {
  test("an unheld pair is a cell that is not tappable, not a missing one", () => {
    const { rows } = buildMatrix({
      positions: [
        position({ account_id: "acc1", instrument_id: "goog", market_value: "500" }),
        position({ account_id: "acc2", instrument_id: "voo", market_value: "900" }),
      ],
      instruments: INSTRUMENTS,
      accounts: ACCOUNTS,
    });

    // Every row is the same width, so the table stays a table.
    expect(rows.every((row) => row.cells.length === 2)).toBe(true);

    const goog = rows.find((r) => r.instrumentId === "goog");
    expect(goog?.cells).toEqual([
      { accountId: "acc2", held: false, value: null },
      { accountId: "acc1", held: true, value: 500 },
    ]);
  });

  test("a held-but-unpriced cell is distinguishable from an empty one", () => {
    const { rows } = buildMatrix({
      positions: [
        position({ account_id: "acc1", instrument_id: "goog", market_value: null }),
        position({ account_id: "acc2", instrument_id: "voo", market_value: "900" }),
      ],
      instruments: INSTRUMENTS,
      accounts: ACCOUNTS,
    });

    const goog = rows.find((r) => r.instrumentId === "goog");
    expect(goog?.cells.find((c) => c.accountId === "acc1")).toEqual({
      accountId: "acc1",
      held: true,
      value: null,
    });
    expect(goog?.total).toBeNull();
    // Unpriced sorts last rather than as zero.
    expect(rows.map((r) => r.instrumentId)).toEqual(["voo", "goog"]);
  });

  test("falls back to raw ids before the catalogs have loaded", () => {
    const { columns, rows } = buildMatrix({
      positions: [position({ account_id: "acc1", instrument_id: "goog" })],
      instruments: undefined,
      accounts: undefined,
    });

    expect(rows[0].symbol).toBe("GOOG");
    expect(columns[0].label).toBe("acc1");
  });

  test("is empty, not undefined, with nothing loaded", () => {
    expect(
      buildMatrix({
        positions: undefined,
        instruments: undefined,
        accounts: undefined,
      }),
    ).toEqual({ columns: [], rows: [] });
  });
});

describe("buildMatrix — nothing is truncated", () => {
  // The guarantee behaviour.md § Grid makes, and the one no seeded
  // portfolio is big enough to prove: the prototype capped the matrix at
  // 4 accounts × 7 instruments, and both limits are replaced. So: feed it
  // a portfolio far past both caps and count.
  const WIDE_ACCOUNTS = 9;
  const TALL_INSTRUMENTS = 14;

  const instruments = Array.from(
    { length: TALL_INSTRUMENTS },
    (_, i) =>
      ({
        id: `i${i}`,
        symbol: `SYM${i}`,
        name: `Instrument ${i}`,
        asset_class: "equity",
      }) as const,
  );
  const accounts = Array.from(
    { length: WIDE_ACCOUNTS },
    (_, i) =>
      ({
        id: `a${i}`,
        name: `Account ${i}`,
        institution: "Somewhere",
        account_type: "brokerage",
      }) as const,
  );

  // Every instrument in every account except a deliberately sparse
  // diagonal, so empty cells exist at every depth of the table.
  const positions = accounts.flatMap((account, a) =>
    instruments
      .filter((_, i) => i !== a)
      .map((instrument, i) =>
        position({
          account_id: account.id,
          instrument_id: instrument.id,
          market_value: String(1000 + a * 10 + i),
        }),
      ),
  );

  const withCashOnly = [
    ...positions,
    // A tenth account that holds nothing but cash, plus a fully closed
    // fifteenth instrument. Neither may add an axis.
    position({
      account_id: "cash-only",
      instrument_id: "cash",
      market_value: "53000",
    }),
    position({
      account_id: "a0",
      instrument_id: "closed",
      share_count: "0",
      market_value: "0",
      realized_gain: "500",
    }),
  ];

  const matrix = buildMatrix({
    positions: withCashOnly,
    instruments: [
      ...instruments,
      { id: "cash", symbol: "USD", name: "Cash", asset_class: "cash" },
      { id: "closed", symbol: "GONE", name: "Sold out", asset_class: "equity" },
    ],
    accounts: [
      ...accounts,
      {
        id: "cash-only",
        name: "Cash Reserve",
        institution: "Ally",
        account_type: "cash",
      },
    ],
  });

  test("keeps every instrument with a live position, past the prototype's 7", () => {
    expect(matrix.rows).toHaveLength(TALL_INSTRUMENTS);
    expect(new Set(matrix.rows.map((r) => r.instrumentId)).size).toBe(
      TALL_INSTRUMENTS,
    );
    expect(matrix.rows.map((r) => r.instrumentId)).not.toContain("closed");
  });

  test("keeps every account holding one, past the prototype's 4, and omits the cash-only one", () => {
    expect(matrix.columns).toHaveLength(WIDE_ACCOUNTS);
    expect(matrix.columns.map((c) => c.accountId)).not.toContain("cash-only");
  });

  test("every row is exactly as wide as the column set", () => {
    for (const row of matrix.rows) {
      expect(row.cells).toHaveLength(WIDE_ACCOUNTS);
      expect(row.cells.map((c) => c.accountId)).toEqual(
        matrix.columns.map((c) => c.accountId),
      );
    }
  });

  test("the sparse diagonal comes back as unheld cells", () => {
    const empty = matrix.rows.flatMap((row) =>
      row.cells.filter((cell) => !cell.held),
    );
    // One per account, since account `aN` skips instrument `iN`.
    expect(empty).toHaveLength(WIDE_ACCOUNTS);
    expect(empty.every((cell) => cell.value === null)).toBe(true);
  });
});
