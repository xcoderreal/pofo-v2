import { describe, expect, test } from "bun:test";
import {
  clearAccount,
  clearInstrument,
  INITIAL_VIEW_STATE,
  selectAccount,
  selectInstrument,
  type ViewState,
} from "@/lib/drilldown";
import {
  buildMetricOptions,
  formatMetricValue,
  METRICS,
  metricHasAccountDimension,
  metricHasInstrumentDimension,
  metricKind,
  metricLabel,
  metricMode,
  metricNote,
  metricRequiresInstrument,
  NEEDS_INSTRUMENT_REASON,
  repairMetricForScope,
  resolveMetricChoice,
  type Metric,
  type MetricScopeState,
} from "@/lib/metrics";

const INSTRUMENT = "goog";
const ACCOUNT = "ira";

/** The four scopes, named as the levels they are. */
const SCOPES = [
  { name: "portfolio", instrumentId: null, accountId: null },
  { name: "account", instrumentId: null, accountId: ACCOUNT },
  { name: "instrument", instrumentId: INSTRUMENT, accountId: null },
  { name: "slice", instrumentId: INSTRUMENT, accountId: ACCOUNT },
] as const;

/**
 * The API's rejection rules, restated from the backend rather than from
 * `lib/metrics.ts`.
 *
 * Written out with literal metric names on purpose: an oracle that reuses
 * the module's own predicates would agree with a wrong implementation.
 * These two lines are `query_service.query_timeseries`'s guard clauses
 * (docs/domain-model.md § Query interface).
 */
function apiRejects(state: MetricScopeState): boolean {
  if (state.metric === "market_price" && state.accountId !== null) return true;
  if (state.metric === "cash_balance" && state.instrumentId !== null) return true;
  return false;
}

/**
 * States the Metric sheet refuses to offer. Not an API rejection — the
 * backend would happily average prices across every instrument you hold —
 * but a meaningless answer the UI has decided not to produce
 * (docs/adr/0001-dashboard-v2.md § 6).
 */
function needsMissingInstrument(state: MetricScopeState): boolean {
  return (
    (state.metric === "share_count" || state.metric === "market_price") &&
    state.instrumentId === null
  );
}

function scopeState(
  metric: Metric,
  scope: { instrumentId: string | null; accountId: string | null },
): MetricScopeState {
  return { metric, instrumentId: scope.instrumentId, accountId: scope.accountId };
}

describe("metric catalog", () => {
  test("the closed enum is all seven, once each", () => {
    expect(METRICS.length).toBe(7);
    expect(new Set(METRICS).size).toBe(7);
  });

  test("every metric has a label and a note", () => {
    for (const metric of METRICS) {
      expect(metricLabel(metric).length).toBeGreaterThan(0);
      expect(metricNote(metric).length).toBeGreaterThan(0);
    }
  });

  test("realized_gain is the only Flow", () => {
    for (const metric of METRICS) {
      expect(metricKind(metric)).toBe(
        metric === "realized_gain" ? "flow" : "level",
      );
    }
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

  test("share count and market price are the ones that need an instrument", () => {
    for (const metric of METRICS) {
      expect(metricRequiresInstrument(metric)).toBe(
        metric === "share_count" || metric === "market_price",
      );
    }
  });
});

describe("metricMode — the (metric, mode) table", () => {
  test("every Level is point_in_time, whatever the cumulative flag says", () => {
    for (const metric of METRICS.filter((m) => metricKind(m) === "level")) {
      expect(metricMode(metric, false)).toBe("point_in_time");
      expect(metricMode(metric, true)).toBe("point_in_time");
    }
  });

  test("the Flow is per-period or cumulative, never point_in_time", () => {
    // A Flow is only meaningful over an interval; the service rejects
    // point_in_time for realized_gain with a 400.
    expect(metricMode("realized_gain", false)).toBe("delta_per_period");
    expect(metricMode("realized_gain", true)).toBe("cumulative");
  });
});

describe("resolveMetricChoice — exhaustive over metric × scope", () => {
  // 7 metrics × 4 scopes. The claim being proved is that the resolver is
  // *total*: every cell is either a stated reason or a scope the API
  // accepts. Nothing falls through, so no reachable tap can 400.
  for (const scope of SCOPES) {
    for (const metric of METRICS) {
      test(`${metric} from ${scope.name}`, () => {
        const from = scopeState("equity", scope);
        const choice = resolveMetricChoice(from, metric);

        if (!choice.selectable) {
          // The only reason to refuse is a missing instrument.
          expect(metricRequiresInstrument(metric)).toBe(true);
          expect(scope.instrumentId).toBeNull();
          expect(choice.reason).toBe(NEEDS_INSTRUMENT_REASON);
          return;
        }

        expect(choice.next.metric).toBe(metric);
        expect(apiRejects(choice.next)).toBe(false);
        expect(needsMissingInstrument(choice.next)).toBe(false);
        // Nothing is cleared that didn't have to be.
        expect(choice.cleared.includes("instrument")).toBe(
          scope.instrumentId !== null && !metricHasInstrumentDimension(metric),
        );
        expect(choice.cleared.includes("account")).toBe(
          scope.accountId !== null && !metricHasAccountDimension(metric),
        );
        expect(choice.undoMessage === null).toBe(choice.cleared.length === 0);
      });
    }
  }

  test("the two disabled cells are exactly share count and market price without an instrument", () => {
    const disabled: string[] = [];
    for (const scope of SCOPES) {
      for (const metric of METRICS) {
        const choice = resolveMetricChoice(scopeState("equity", scope), metric);
        if (!choice.selectable) disabled.push(`${metric}@${scope.name}`);
      }
    }

    expect(disabled.sort()).toEqual([
      "market_price@account",
      "market_price@portfolio",
      "share_count@account",
      "share_count@portfolio",
    ]);
  });
});

describe("resolveMetricChoice — the auto-clear half", () => {
  test("market price from a slice clears the account chip", () => {
    // behaviour.md § Auto-adjustments 3.
    const choice = resolveMetricChoice(
      scopeState("equity", SCOPES[3]),
      "market_price",
    );

    expect(choice.selectable).toBe(true);
    if (!choice.selectable) return;
    expect(choice.cleared).toEqual(["account"]);
    expect(choice.next.accountId).toBeNull();
    expect(choice.next.instrumentId).toBe(INSTRUMENT);
    expect(choice.undoMessage).toBe(
      "Account filter removed — market price has no account dimension",
    );
  });

  test("cash balance from a slice clears the instrument chip", () => {
    // behaviour.md § Auto-adjustments 4.
    const choice = resolveMetricChoice(
      scopeState("equity", SCOPES[3]),
      "cash_balance",
    );

    expect(choice.selectable).toBe(true);
    if (!choice.selectable) return;
    expect(choice.cleared).toEqual(["instrument"]);
    expect(choice.next.instrumentId).toBeNull();
    expect(choice.next.accountId).toBe(ACCOUNT);
    expect(choice.undoMessage).toBe(
      "Instrument filter removed — cash balance has no instrument dimension",
    );
  });

  test("an ordinary switch clears nothing and offers no undo", () => {
    const choice = resolveMetricChoice(
      scopeState("equity", SCOPES[3]),
      "cost_basis",
    );

    expect(choice.selectable).toBe(true);
    if (!choice.selectable) return;
    expect(choice.cleared).toEqual([]);
    expect(choice.undoMessage).toBeNull();
    expect(choice.next.instrumentId).toBe(INSTRUMENT);
    expect(choice.next.accountId).toBe(ACCOUNT);
  });

  test("the caller's other state rides through, so Undo can restore it", () => {
    const before: ViewState = {
      ...INITIAL_VIEW_STATE,
      instrumentId: INSTRUMENT,
      accountId: ACCOUNT,
      rangeKey: "3M",
      granularity: "weekly",
      tab: "accounts",
      cumulative: true,
    };
    const choice = resolveMetricChoice(before, "cash_balance");

    expect(choice.selectable).toBe(true);
    if (!choice.selectable) return;
    expect(choice.next).toEqual({
      ...before,
      metric: "cash_balance",
      instrumentId: null,
    });
  });
});

describe("no reachable UI state produces a rejected query", () => {
  // The acceptance criterion, proved rather than sampled: walk the whole
  // transition graph from the initial state and assert the closure.
  test("the reachable set is closed under every transition the screen offers", () => {
    const key = (s: ViewState) =>
      `${s.metric}|${s.instrumentId ?? "-"}|${s.accountId ?? "-"}`;
    const seen = new Map<string, ViewState>();
    const queue: ViewState[] = [INITIAL_VIEW_STATE];

    while (queue.length > 0) {
      const current = queue.pop() as ViewState;
      const id = key(current);
      if (seen.has(id)) continue;
      seen.set(id, current);

      const successors: ViewState[] = [
        selectInstrument(current, INSTRUMENT),
        selectAccount(current, ACCOUNT, { holdsInstruments: true }),
        selectAccount(current, ACCOUNT, { holdsInstruments: false }),
        clearInstrument(current),
        clearAccount(current),
      ];
      for (const metric of METRICS) {
        const choice = resolveMetricChoice(current, metric);
        if (choice.selectable) successors.push(choice.next);
      }
      queue.push(...successors);
    }

    // Every state the user can tap their way into is one the API answers,
    // and one the Metric sheet would have been willing to offer.
    const bad = [...seen.values()].filter(
      (s) => apiRejects(s) || needsMissingInstrument(s),
    );
    expect(bad).toEqual([]);
    // A sanity floor: if the walk had stalled, the closure would be
    // trivially clean.
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("repairMetricForScope", () => {
  test("a metric that needs an instrument falls back to equity without one", () => {
    const stranded: MetricScopeState = {
      metric: "market_price",
      instrumentId: null,
      accountId: null,
    };

    expect(repairMetricForScope(stranded).metric).toBe("equity");
  });

  test("everything else is left exactly as it was", () => {
    const before: MetricScopeState = {
      metric: "cash_balance",
      instrumentId: null,
      accountId: ACCOUNT,
    };

    expect(repairMetricForScope(before)).toBe(before);
  });
});

describe("buildMetricOptions", () => {
  test("all seven rows are always present, disabled rather than hidden", () => {
    const options = buildMetricOptions(scopeState("equity", SCOPES[0]));

    expect(options.map((o) => o.metric)).toEqual([...METRICS]);
    expect(options.filter((o) => o.disabled).map((o) => o.metric)).toEqual([
      "share_count",
      "market_price",
    ]);
  });

  test("a disabled row carries the reason inline", () => {
    const options = buildMetricOptions(scopeState("equity", SCOPES[0]));
    const marketPrice = options.find((o) => o.metric === "market_price");

    expect(marketPrice?.note).toBe("One instrument only — pick an instrument first");
  });

  test("a row that will clear a chip says so before it is tapped", () => {
    const options = buildMetricOptions(scopeState("equity", SCOPES[3]));

    expect(options.find((o) => o.metric === "market_price")?.note).toBe(
      "One instrument only — clears the account filter",
    );
    expect(options.find((o) => o.metric === "cash_balance")?.note).toBe(
      "Uninvested cash — clears the instrument filter",
    );
  });

  test("exactly one row is marked as the current selection", () => {
    const options = buildMetricOptions(scopeState("cost_basis", SCOPES[3]));

    expect(options.filter((o) => o.selected).map((o) => o.metric)).toEqual([
      "cost_basis",
    ]);
  });

  test("at instrument level nothing is disabled — every metric has its dimension", () => {
    const options = buildMetricOptions(scopeState("equity", SCOPES[2]));

    expect(options.filter((o) => o.disabled)).toEqual([]);
  });
});

describe("formatMetricValue", () => {
  test("a share count is not money", () => {
    expect(formatMetricValue("share_count", 205)).toBe("205");
  });

  test("a price keeps its cents however large it is", () => {
    // formatUsd drops cents above $10,000 because a portfolio total
    // doesn't need them; a per-share price always does.
    expect(formatMetricValue("market_price", 64_250.5)).toBe("$64,250.50");
  });

  test("everything else is the shared money format", () => {
    expect(formatMetricValue("equity", 1234.5)).toBe("$1,234.50");
    expect(formatMetricValue("unrealized_gain", -1234.5)).toBe("−$1,234.50");
  });
});
