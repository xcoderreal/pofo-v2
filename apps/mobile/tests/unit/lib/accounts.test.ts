import { describe, expect, test } from "bun:test";
import {
  accountIdFromName,
  buildAccountOptions,
  WHOLE_PORTFOLIO_KEY,
} from "@/lib/accounts";
import type { PositionRow } from "@/lib/positions";

describe("accountIdFromName", () => {
  test("slugifies a simple name", () => {
    expect(accountIdFromName("Wells Fargo Brokerage")).toBe(
      "wells-fargo-brokerage",
    );
  });

  test("collapses punctuation and trims leading/trailing hyphens", () => {
    expect(accountIdFromName("  Fidelity — IRA! ")).toBe("fidelity-ira");
  });
});

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

const INSTRUMENTS = [
  { id: "goog", symbol: "GOOG", name: "Alphabet Inc", asset_class: "equity" },
] as const;

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

describe("buildAccountOptions — the Accounts sheet's rows", () => {
  test("the whole-portfolio row comes first and counts the accounts", () => {
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: null,
    });

    expect(options[0].key).toBe(WHOLE_PORTFOLIO_KEY);
    expect(options[0].note).toBe("All 2 accounts combined");
    expect(options[0].selected).toBe(true);
    expect(options[0].disabled).toBe(false);
  });

  test("with no instrument in scope every account is selectable", () => {
    // An account with nothing in it is still a legitimate destination —
    // the equity -> cash_balance auto-adjustment and the empty state are
    // what handle it (behaviour.md § Auto-adjustments).
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: null,
    });

    expect(options.map((o) => o.disabled)).toEqual([false, false, false]);
    expect(options[1].note).toBe("Wells Fargo · Taxable brokerage");
  });

  test("with an instrument in scope an account that never held it is disabled", () => {
    // The bug this guards against: AC 18.6 asks for invalid options to be
    // shown with the reason inline, and the Accounts sheet disabled
    // nothing at all — picking Cash Reserve while holding GOOG built a
    // slice with no rows and no chart.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [position({ account_id: "acc1" })],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[1]).toMatchObject({ key: "acc1", disabled: false });
    expect(options[2]).toMatchObject({
      key: "acc2",
      disabled: true,
      note: "Never held GOOG",
    });
  });

  test("a fully closed position keeps its account selectable", () => {
    // Zero shares, but the realized gain and the closed row are real
    // things the slice has to say.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [
        position({ account_id: "acc2", share_count: "0", realized_gain: "340" }),
      ],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[2]).toMatchObject({ key: "acc2", disabled: false });
  });

  test("the selected account is marked, and the whole-portfolio row is not", () => {
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: "acc2",
      selectedInstrumentId: null,
    });

    expect(options.map((o) => o.selected)).toEqual([false, false, true]);
  });

  test("falls back to the raw id when the catalog has not loaded", () => {
    // Same reasoning as the chips: a reason naming "GOOG" is better than
    // one naming nothing at all.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: undefined,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[1].note).toBe("Never held GOOG");
  });

  test("no accounts yet is an empty list, not a crash", () => {
    const options = buildAccountOptions({
      accounts: undefined,
      positions: undefined,
      instruments: undefined,
      selectedAccountId: null,
      selectedInstrumentId: null,
    });

    expect(options).toHaveLength(1);
    expect(options[0].note).toBe("All 0 accounts combined");
  });
});
