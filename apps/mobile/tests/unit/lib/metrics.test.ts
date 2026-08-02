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
  defaultRangeForMetric,
  flowBetween,
  flowTotal,
  formatMetricValue,
  formatSignedMetric,
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

describe("formatSignedMetric — the delta line under the headline", () => {
  test("a share-count delta is a count, not dollars", () => {
    // The bug this guards against: the delta line reached for the
    // USD-only formatter, so 10 shares -> 15 rendered "+$5.00" directly
    // under a headline correctly reading "15".
    expect(formatSignedMetric("share_count", 5)).toBe("+5");
    expect(formatSignedMetric("share_count", -2.5)).toBe("−2.5");
  });

  test("a price delta keeps its cents", () => {
    expect(formatSignedMetric("market_price", 12_345.5)).toBe("+$12,345.50");
  });

  test("money metrics are unchanged", () => {
    expect(formatSignedMetric("equity", 1234.5)).toBe("+$1,234.50");
    expect(formatSignedMetric("unrealized_gain", -1234.5)).toBe("−$1,234.50");
  });

  test("zero reads as a rise, matching the colour rule above it", () => {
    expect(formatSignedMetric("equity", 0)).toBe("+$0.00");
  });
});

describe("flowTotal", () => {
  test("per period sums the buckets", () => {
    expect(flowTotal([300, -100, 900], false)).toBe(1100);
  });

  test("cumulative reads the running total off the last bucket", () => {
    // The same series as above, as the API returns it in `cumulative`
    // mode. Summing it would triple-count January.
    expect(flowTotal([300, 200, 1100], true)).toBe(1100);
  });

  test("both modes agree on the total for the same underlying gains", () => {
    const perPeriod = [300, -100, 900];
    let running = 0;
    const cumulative = perPeriod.map((value) => (running += value));

    expect(flowTotal(cumulative, true)).toBe(flowTotal(perPeriod, false));
  });

  test("an empty range booked nothing, in either mode", () => {
    expect(flowTotal([], false)).toBe(0);
    expect(flowTotal([], true)).toBe(0);
  });

  test("a losing range totals negative", () => {
    expect(flowTotal([-400, -100], false)).toBe(-500);
  });
});

describe("defaultRangeForMetric", () => {
  test("realized gain defaults to year-to-date — the tax-relevant window", () => {
    expect(defaultRangeForMetric("realized_gain")).toBe("YTD");
  });

  test("every Level metric keeps the range that is showing", () => {
    for (const metric of METRICS.filter((m) => metricKind(m) === "level")) {
      expect(defaultRangeForMetric(metric)).toBeNull();
    }
  });

  test("the one metric with an opinion is the one Flow", () => {
    const opinionated = METRICS.filter(
      (m) => defaultRangeForMetric(m) !== null,
    );

    expect(opinionated).toEqual(["realized_gain"]);
    expect(opinionated.map(metricKind)).toEqual(["flow"]);
  });
});

describe("flowBetween", () => {
  test("per-period sums the window, both ends included", () => {
    expect(flowBetween([300, -100, 500, 200], 1, 3, false)).toBe(600);
  });

  test("cumulative reaches the same figure from running totals", () => {
    // The same gains described two ways, so a window's total must not
    // depend on which mode the chart is in.
    const perPeriod = [300, -100, 500, 200];
    const running = [300, 200, 700, 900];

    for (const [lo, hi] of [
      [0, 3],
      [0, 0],
      [1, 3],
      [2, 2],
      [1, 2],
    ]) {
      expect(flowBetween(running, lo, hi, true)).toBe(
        flowBetween(perPeriod, lo, hi, false),
      );
    }
  });

  test("a window from the first bucket is the same as flowTotal over it", () => {
    const perPeriod = [300, -100, 500, 200];

    expect(flowBetween(perPeriod, 0, 3, false)).toBe(flowTotal(perPeriod, false));
  });

  test("the two pins may arrive in either order", () => {
    expect(flowBetween([300, -100, 500], 2, 0, false)).toBe(
      flowBetween([300, -100, 500], 0, 2, false),
    );
  });

  test("one bucket is its own booking", () => {
    expect(flowBetween([300, -100, 500], 1, 1, false)).toBe(-100);
    expect(flowBetween([300, 200, 700], 1, 1, true)).toBe(-100);
  });

  test("indices outside the series are clamped rather than read", () => {
    expect(flowBetween([300, -100], 0, 9, false)).toBe(200);
    expect(flowBetween([], 0, 3, false)).toBe(0);
  });
});
