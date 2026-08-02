import { describe, expect, test } from "bun:test";
import {
  activityScopeLabel,
  buildActivity,
  cashDelta,
  cashInstrumentIds,
  classifyEntry,
  isTradeCashLeg,
  visibleEntries,
  type LedgerEntry,
} from "@/lib/activity";

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
  { id: "acc2", name: "Coinbase", institution: "Coinbase", account_type: "crypto_exchange" },
] as const;

const CASH_IDS = cashInstrumentIds(INSTRUMENTS);

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "t1",
    account_id: "acc1",
    instrument_id: "goog",
    type: "buy",
    quantity: "10",
    price: "100",
    timestamp: "2026-06-03T15:04:58",
    trade_id: null,
    realized_gain: null,
    ...overrides,
  };
}

function build(entries: LedgerEntry[]) {
  return buildActivity({
    entries,
    instruments: INSTRUMENTS,
    accounts: ACCOUNTS,
  });
}

describe("cashInstrumentIds", () => {
  test("reads the catalog's asset_class rather than assuming an id", () => {
    expect([...cashInstrumentIds(INSTRUMENTS)]).toEqual(["cash"]);
  });

  test("an unloaded catalog names nothing as cash", () => {
    expect(cashInstrumentIds(undefined).size).toBe(0);
  });
});

describe("isTradeCashLeg — the suppression predicate", () => {
  test("a CASH row carrying a trade_id is a trade's artifact", () => {
    const leg = entry({ instrument_id: "cash", trade_id: "t9", type: "sell" });
    expect(isTradeCashLeg(leg, CASH_IDS)).toBe(true);
  });

  test("a CASH row with no trade_id is a genuine deposit or withdrawal", () => {
    const deposit = entry({ instrument_id: "cash", trade_id: null });
    expect(isTradeCashLeg(deposit, CASH_IDS)).toBe(false);
  });

  test("a non-CASH row is never suppressed, trade_id or not", () => {
    // The primary leg of a trade carries the same trade_id as its cash
    // counterpart — suppressing on trade_id alone would hide every trade.
    expect(isTradeCashLeg(entry({ trade_id: "t1" }), CASH_IDS)).toBe(false);
  });
});

describe("the same-day, same-amount collision", () => {
  /**
   * Two CASH BUYs, one account, one instant, one amount: the proceeds leg
   * of a sell and a genuine deposit. Any implementation that pairs legs by
   * matching account, timestamp and amount fails this — which is exactly
   * why docs/adr/0001-dashboard-v2.md § 2 stores `trade_id` instead.
   */
  const proceedsLeg = entry({
    id: "sell-1-cash",
    instrument_id: "cash",
    type: "buy",
    quantity: "1500",
    price: "1",
    timestamp: "2026-02-10T09:30:00",
    trade_id: "sell-1",
  });
  const realDeposit = entry({
    id: "dep-1",
    instrument_id: "cash",
    type: "buy",
    quantity: "1500",
    price: "1",
    timestamp: "2026-02-10T09:30:00",
    trade_id: null,
  });

  test("exactly the unpaired row survives", () => {
    const kept = visibleEntries([proceedsLeg, realDeposit], CASH_IDS);

    expect(kept.map((e) => e.id)).toEqual(["dep-1"]);
  });

  test("and exactly one row renders, as a deposit", () => {
    const months = build([proceedsLeg, realDeposit]);

    expect(months).toHaveLength(1);
    expect(months[0].rows).toHaveLength(1);
    expect(months[0].rows[0].badge).toBe("DEP");
    expect(months[0].rows[0].id).toBe("dep-1");
  });
});

describe("classifyEntry", () => {
  test("a CASH buy is a deposit and a CASH sell is a withdrawal", () => {
    expect(classifyEntry(entry({ instrument_id: "cash", type: "buy" }), CASH_IDS)).toBe(
      "deposit",
    );
    expect(
      classifyEntry(entry({ instrument_id: "cash", type: "sell" }), CASH_IDS),
    ).toBe("withdrawal");
  });

  test("an instrument buy and sell keep their own names", () => {
    expect(classifyEntry(entry({ type: "buy" }), CASH_IDS)).toBe("buy");
    expect(classifyEntry(entry({ type: "sell" }), CASH_IDS)).toBe("sell");
  });
});

describe("cashDelta", () => {
  test("a buy takes money out of the account", () => {
    expect(cashDelta(entry({ quantity: "10", price: "100" }), "buy")).toBe(-1000);
  });

  test("a sell puts money in", () => {
    expect(cashDelta(entry({ quantity: "4", price: "150" }), "sell")).toBe(600);
  });

  test("a deposit is positive and a withdrawal negative", () => {
    const cash = entry({ instrument_id: "cash", quantity: "4000", price: "1" });
    expect(cashDelta(cash, "deposit")).toBe(4000);
    expect(cashDelta(cash, "withdrawal")).toBe(-4000);
  });
});

describe("buildActivity", () => {
  test("groups by month, newest month first, newest row first", () => {
    const months = build([
      entry({ id: "a", timestamp: "2026-04-02T10:00:00" }),
      entry({ id: "b", timestamp: "2026-06-20T10:00:00" }),
      entry({ id: "c", timestamp: "2026-06-03T10:00:00" }),
      entry({ id: "d", timestamp: "2026-05-11T10:00:00" }),
    ]);

    expect(months.map((m) => m.key)).toEqual(["2026-06", "2026-05", "2026-04"]);
    expect(months.map((m) => m.label)).toEqual([
      "June 2026",
      "May 2026",
      "April 2026",
    ]);
    expect(months[0].rows.map((r) => r.id)).toEqual(["b", "c"]);
  });

  test("two rows in the same month of different years do not merge", () => {
    const months = build([
      entry({ id: "a", timestamp: "2026-06-02T10:00:00" }),
      entry({ id: "b", timestamp: "2025-06-02T10:00:00" }),
    ]);

    expect(months.map((m) => m.key)).toEqual(["2026-06", "2025-06"]);
  });

  test("a month's net is the sum of its visible rows' cash movement", () => {
    const months = build([
      entry({ id: "dep", instrument_id: "cash", quantity: "5000", price: "1" }),
      entry({ id: "buy", quantity: "10", price: "100" }),
      entry({
        id: "sell",
        type: "sell",
        quantity: "4",
        price: "150",
        realized_gain: "200",
      }),
    ]);

    // 5000 - 1000 + 600
    expect(months[0].net).toBe(4600);
  });

  test("a trade's hidden cash leg is not counted twice in the net", () => {
    const withLeg = build([
      entry({ id: "buy", quantity: "10", price: "100", trade_id: "buy" }),
      entry({
        id: "buy-cash",
        instrument_id: "cash",
        type: "sell",
        quantity: "1000",
        price: "1",
        trade_id: "buy",
      }),
    ]);

    expect(withLeg[0].rows).toHaveLength(1);
    expect(withLeg[0].net).toBe(-1000);
  });

  test("rows carry a badge, a description, the account, the date and a signed amount", () => {
    const [month] = build([
      entry({
        id: "t1",
        account_id: "acc1",
        instrument_id: "goog",
        quantity: "25",
        price: "186",
        timestamp: "2026-06-03T15:04:58",
      }),
    ]);

    expect(month.rows[0]).toMatchObject({
      kind: "buy",
      badge: "BUY",
      description: "GOOG · 25 @ $186.00",
      subtitle: "Wells Fargo Brokerage · Jun 3, 2026",
      amount: "−$4,650.00",
      isOutflow: true,
      realizedGain: null,
    });
  });

  test("a deposit and a withdrawal read as their own concept, not as CASH trades", () => {
    const [month] = build([
      entry({
        id: "dep",
        instrument_id: "cash",
        type: "buy",
        quantity: "9000",
        price: "1",
        timestamp: "2026-06-20T10:00:00",
      }),
      entry({
        id: "wdl",
        instrument_id: "cash",
        type: "sell",
        quantity: "4000",
        price: "1",
        timestamp: "2026-06-03T10:00:00",
        realized_gain: "0",
      }),
    ]);

    expect(month.rows.map((r) => [r.badge, r.description, r.amount])).toEqual([
      ["DEP", "Cash deposit", "+$9,000.00"],
      ["WDL", "Cash withdrawal", "−$4,000.00"],
    ]);
    // A withdrawal's realized gain is a definitional zero, not information.
    expect(month.rows.map((r) => r.realizedGain)).toEqual([null, null]);
  });

  test("a sell carries the gain it booked", () => {
    const [month] = build([
      entry({ id: "s", type: "sell", quantity: "90", price: "288", realized_gain: "3420" }),
    ]);

    expect(month.rows[0].realizedGain).toBe(3420);
    expect(month.rows[0].badge).toBe("SELL");
  });

  test("an unloaded catalog still names the account and the instrument legibly", () => {
    const months = buildActivity({
      entries: [entry({ id: "t1" })],
      instruments: undefined,
      accounts: undefined,
    });

    expect(months[0].rows[0].description).toStartWith("GOOG · ");
    expect(months[0].rows[0].subtitle).toStartWith("acc1 · ");
  });

  test("an empty ledger produces no months at all", () => {
    expect(build([])).toEqual([]);
    expect(
      buildActivity({ entries: undefined, instruments: INSTRUMENTS, accounts: ACCOUNTS }),
    ).toEqual([]);
  });
});

describe("activityScopeLabel", () => {
  test("says how many, and says when the view is filtered", () => {
    expect(activityScopeLabel(20, false)).toBe("20 transactions");
    expect(activityScopeLabel(1, false)).toBe("1 transaction");
    expect(activityScopeLabel(3, true)).toBe("3 matching");
    expect(activityScopeLabel(0, true)).toBe("0 matching");
  });
});
