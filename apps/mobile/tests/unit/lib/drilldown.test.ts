import { describe, expect, test } from "bun:test";
import {
  buildChips,
  clearAccount,
  clearInstrument,
  INITIAL_VIEW_STATE,
  metricHasAccountDimension,
  metricHasInstrumentDimension,
  metricLabel,
  resolveLevel,
  scopeParams,
  selectAccount,
  selectInstrument,
  type ViewState,
} from "@/lib/drilldown";

function state(overrides: Partial<ViewState> = {}): ViewState {
  return { ...INITIAL_VIEW_STATE, ...overrides };
}

describe("resolveLevel — the level is the scope", () => {
  test("neither slot filled is the whole portfolio", () => {
    expect(resolveLevel({ instrumentId: null, accountId: null })).toBe(
      "portfolio",
    );
  });

  test("an account alone is account level", () => {
    expect(resolveLevel({ instrumentId: null, accountId: "ira" })).toBe(
      "account",
    );
  });

  test("an instrument alone is instrument level", () => {
    expect(resolveLevel({ instrumentId: "goog", accountId: null })).toBe(
      "instrument",
    );
  });

  test("both together are a slice", () => {
    expect(resolveLevel({ instrumentId: "goog", accountId: "ira" })).toBe(
      "slice",
    );
  });
});

describe("selectInstrument", () => {
  test("portfolio drills to instrument", () => {
    const next = selectInstrument(state(), "goog");

    expect(resolveLevel(next)).toBe("instrument");
    expect(next.instrumentId).toBe("goog");
  });

  test("an account drills to a slice, keeping the account", () => {
    const next = selectInstrument(state({ accountId: "ira" }), "goog");

    expect(resolveLevel(next)).toBe("slice");
    expect(next.accountId).toBe("ira");
  });

  test("auto-adjustment 2: cash balance switches back to equity", () => {
    // behaviour.md § Auto-adjustments — cash_balance has no instrument
    // dimension, so the API would reject the very query this selection
    // is asking for.
    const next = selectInstrument(state({ metric: "cash_balance" }), "goog");

    expect(next.metric).toBe("equity");
  });

  test("any other metric is left alone", () => {
    const next = selectInstrument(state({ metric: "cost_basis" }), "goog");

    expect(next.metric).toBe("cost_basis");
  });

  test("the list returns to holdings — an accounts list under one instrument is not a question", () => {
    const next = selectInstrument(state({ tab: "accounts" }), "goog");

    expect(next.tab).toBe("holdings");
  });
});

describe("selectAccount", () => {
  test("portfolio drills to account", () => {
    const next = selectAccount(state(), "ira", { holdsInstruments: true });

    expect(resolveLevel(next)).toBe("account");
  });

  test("an instrument drills to a slice", () => {
    const next = selectAccount(state({ instrumentId: "goog" }), "ira", {
      holdsInstruments: true,
    });

    expect(resolveLevel(next)).toBe("slice");
  });

  test("auto-adjustment 1: an account with no instruments switches to cash balance", () => {
    const next = selectAccount(state(), "reserve", {
      holdsInstruments: false,
    });

    expect(next.metric).toBe("cash_balance");
  });

  test("the switch covers every holdings metric, not just equity", () => {
    for (const metric of ["equity", "cost_basis", "unrealized_gain"] as const) {
      const next = selectAccount(state({ metric }), "reserve", {
        holdsInstruments: false,
      });

      expect(next.metric).toBe("cash_balance");
    }
  });

  test("a metric that is not about holdings is not switched", () => {
    // realized_gain is a flow over the ledger: an account with only cash
    // movements still has a meaningful (zero) answer, and rewriting the
    // metric would be an unasked-for change with nothing gained.
    const next = selectAccount(state({ metric: "realized_gain" }), "reserve", {
      holdsInstruments: false,
    });

    expect(next.metric).toBe("realized_gain");
  });

  test("arriving at an account that does hold instruments restores equity", () => {
    // The converse repair, from the prototype's gotoAcct: without it one
    // visit to a cash-only account leaves every later account stuck
    // showing its cash balance.
    const next = selectAccount(state({ metric: "cash_balance" }), "ira", {
      holdsInstruments: true,
    });

    expect(next.metric).toBe("equity");
  });
});

describe("clearing a chip", () => {
  test("instrument: a slice steps back to its account", () => {
    const next = clearInstrument(
      state({ instrumentId: "goog", accountId: "ira" }),
    );

    expect(resolveLevel(next)).toBe("account");
    expect(next.accountId).toBe("ira");
  });

  test("instrument: instrument level steps back to the portfolio", () => {
    const next = clearInstrument(state({ instrumentId: "goog" }));

    expect(resolveLevel(next)).toBe("portfolio");
  });

  test("account: a slice steps back to its instrument", () => {
    const next = clearAccount(state({ instrumentId: "goog", accountId: "ira" }));

    expect(resolveLevel(next)).toBe("instrument");
    expect(next.instrumentId).toBe("goog");
  });

  test("account: account level steps back to the portfolio", () => {
    const next = clearAccount(state({ accountId: "ira" }));

    expect(resolveLevel(next)).toBe("portfolio");
  });

  test("everything else is carried through untouched, so Undo has something to restore", () => {
    const before = state({
      instrumentId: "goog",
      accountId: "ira",
      metric: "cost_basis",
      rangeKey: "3M",
      granularity: "weekly",
      tab: "accounts",
      cumulative: true,
    });

    expect(clearInstrument(before)).toEqual({ ...before, instrumentId: null });
    expect(clearAccount(before)).toEqual({ ...before, accountId: null });
  });
});

describe("metric dimensions", () => {
  test("cash_balance has no instrument dimension", () => {
    expect(metricHasInstrumentDimension("cash_balance")).toBe(false);
    expect(metricHasInstrumentDimension("equity")).toBe(true);
  });

  test("market_price has no account dimension", () => {
    expect(metricHasAccountDimension("market_price")).toBe(false);
    expect(metricHasAccountDimension("equity")).toBe(true);
  });

  test("every metric has a label", () => {
    for (const metric of [
      "equity",
      "cash_balance",
      "unrealized_gain",
      "realized_gain",
      "cost_basis",
      "share_count",
      "market_price",
    ] as const) {
      expect(metricLabel(metric).length).toBeGreaterThan(0);
    }
  });
});

describe("scopeParams", () => {
  test("the portfolio filters on nothing", () => {
    expect(scopeParams(state())).toEqual({});
  });

  test("a slice filters on both dimensions", () => {
    expect(
      scopeParams(state({ instrumentId: "goog", accountId: "ira" })),
    ).toEqual({ instruments: ["goog"], accounts: ["ira"] });
  });

  test("a dimension the metric doesn't have is omitted, not sent", () => {
    // The API answers instruments-with-cash_balance with a 400 rather
    // than ignoring it (docs/domain-model.md § Query interface).
    expect(
      scopeParams(
        state({
          instrumentId: "goog",
          accountId: "ira",
          metric: "cash_balance",
        }),
      ),
    ).toEqual({ accounts: ["ira"] });

    expect(
      scopeParams(
        state({
          instrumentId: "goog",
          accountId: "ira",
          metric: "market_price",
        }),
      ),
    ).toEqual({ instruments: ["goog"] });
  });
});

describe("buildChips", () => {
  const instruments = [
    { id: "goog", symbol: "GOOG", name: "Alphabet Inc", asset_class: "equity" },
  ] as const;
  const accounts = [
    {
      id: "ira",
      name: "Wells Fargo IRA",
      institution: "Wells Fargo",
      account_type: "ira",
    },
  ] as const;

  test("the portfolio has no chips", () => {
    expect(
      buildChips({
        scope: { instrumentId: null, accountId: null },
        instruments,
        accounts,
      }),
    ).toEqual([]);
  });

  test("a slice shows both, instrument first", () => {
    expect(
      buildChips({
        scope: { instrumentId: "goog", accountId: "ira" },
        instruments,
        accounts,
      }),
    ).toEqual([
      { kind: "instrument", label: "GOOG" },
      { kind: "account", label: "Wells Fargo IRA" },
    ]);
  });

  test("a chip still appears before the catalog loads", () => {
    // A narrowed view with no visible chip is a trap: the lists are
    // filtered with nothing on screen saying so and no control to undo it.
    expect(
      buildChips({
        scope: { instrumentId: "goog", accountId: "ira" },
        instruments: undefined,
        accounts: undefined,
      }),
    ).toEqual([
      { kind: "instrument", label: "GOOG" },
      { kind: "account", label: "ira" },
    ]);
  });
});
