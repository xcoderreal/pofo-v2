/**
 * The seven metrics, their dimensions, and the metric/scope conflict
 * resolver.
 *
 * Zero React imports by design (see CLAUDE.md). The resolver is the
 * interesting part and it is a pure function, so "can any sequence of taps
 * build a query the API rejects?" is answered by `bun test` rather than by
 * clicking through a rendered screen.
 *
 * ## Why a resolver exists at all
 *
 * The query interface rejects a scope dimension a metric doesn't have —
 * deliberately, "rather than silently ignoring it" (docs/domain-model.md
 * § Query interface). Two ordinary UI states hit that: `market_price`
 * while an account is selected, and `cash_balance` while an instrument is.
 * So the client resolves the mismatch *before* it builds a request
 * (docs/adr/0001-dashboard-v2.md § 6). One rule, two halves:
 *
 * - A metric that **needs** a dimension you lack (`share_count`,
 *   `market_price` with no instrument) is **disabled**, with the reason
 *   shown. The app cannot guess which instrument was meant.
 * - A metric that **lacks** a dimension you have auto-**clears that chip**,
 *   with the same Undo toast every other filter-clearing change raises.
 *
 * `resolveMetricChoice` is *total*: for every (metric, scope) pair it
 * returns either a reason it cannot be picked, or a scope that is valid.
 * That totality is what makes the unreachable-bad-state claim provable.
 */

import type { components } from "./api-types";
import { formatShares, formatUsd } from "./format";
import type { RangeKey } from "./timeseries";

export type Metric = components["schemas"]["Metric"];
export type Mode = components["schemas"]["Mode"];

/** Every metric, in the order the Metric sheet lists them. */
export const METRICS: readonly Metric[] = [
  "equity",
  "cash_balance",
  "unrealized_gain",
  "realized_gain",
  "cost_basis",
  "share_count",
  "market_price",
];

/**
 * Level or Flow — the accounting stock/flow distinction, which fully
 * determines which `Mode`s are legal (docs/domain-model.md § (Metric, Mode)
 * validity). `realized_gain` is the only Flow.
 */
export type MetricKind = "level" | "flow";

export function metricKind(metric: Metric): MetricKind {
  return metric === "realized_gain" ? "flow" : "level";
}

/**
 * The `mode` to query a metric with.
 *
 * A Level is only meaningful at an instant and a Flow only over an
 * interval, so there is exactly one sensible mode per metric — plus
 * `realized_gain`'s per-period/cumulative choice, which is the only place
 * the caller has a say (#19 gives it a control; the flag already rides in
 * `ViewState` so Undo can restore it).
 */
export function metricMode(metric: Metric, cumulative: boolean): Mode {
  if (metricKind(metric) === "flow") {
    return cumulative ? "cumulative" : "delta_per_period";
  }
  return "point_in_time";
}

/**
 * A Flow's headline figure: the total booked across the whole visible
 * range (behaviour.md § Metrics).
 *
 * The two modes reach the same number by different routes, which is the
 * point of it being one function — `delta_per_period` hands back what each
 * bucket booked, so the total is their sum, while `cumulative` has already
 * summed them and the total is simply the last bucket. Reading the last
 * point in both modes would show the final month's gain and call it the
 * year's.
 */
export function flowTotal(values: readonly number[], cumulative: boolean): number {
  if (values.length === 0) return 0;
  if (cumulative) return values[values.length - 1];
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The range a metric wants when it is selected from search (#26).
 *
 * `null` means "keep whatever range is showing" — which is every metric
 * but one. `realized_gain` asks for year-to-date because that is the
 * tax-relevant window, and a Flow's default range is a statement about
 * *what is being asked*, not a leftover from the previous view: "how much
 * did I book" over an arbitrary trailing year answers nothing anyone filed.
 *
 * Deliberately not applied by the Metric sheet. Switching metric from the
 * sheet is a change of one thing, and silently moving the range under a
 * user who just set it is the kind of help nobody asked for. Search is
 * different — it constructs a whole destination at once.
 */
export function defaultRangeForMetric(metric: Metric): RangeKey | null {
  return metric === "realized_gain" ? "YTD" : null;
}

// ─── Dimensions ───────────────────────────────────────────────

const NO_INSTRUMENT_DIMENSION: readonly Metric[] = ["cash_balance"];
const NO_ACCOUNT_DIMENSION: readonly Metric[] = ["market_price"];
/** Metrics that are a single instrument's property, so a portfolio-wide
 * answer would be a sum or an average of unlike things. */
const REQUIRES_INSTRUMENT: readonly Metric[] = ["share_count", "market_price"];

export function metricHasInstrumentDimension(metric: Metric): boolean {
  return !NO_INSTRUMENT_DIMENSION.includes(metric);
}

export function metricHasAccountDimension(metric: Metric): boolean {
  return !NO_ACCOUNT_DIMENSION.includes(metric);
}

export function metricRequiresInstrument(metric: Metric): boolean {
  return REQUIRES_INSTRUMENT.includes(metric);
}

/** Header label for a metric, as the design writes it. */
export function metricLabel(metric: Metric): string {
  switch (metric) {
    case "equity":
      return "Equity value";
    case "cash_balance":
      return "Cash balance";
    case "unrealized_gain":
      return "Unrealized gain";
    case "realized_gain":
      return "Realized gain";
    case "cost_basis":
      return "Cost basis";
    case "share_count":
      return "Share count";
    case "market_price":
      return "Market price";
  }
}

/** The one-line explanation each Metric sheet row carries. */
export function metricNote(metric: Metric): string {
  switch (metric) {
    case "equity":
      return "Market value of holdings";
    case "cash_balance":
      return "Uninvested cash";
    case "unrealized_gain":
      return "Market value − cost basis";
    case "realized_gain":
      return "Booked on sells";
    case "cost_basis":
      return "What you paid, at average cost";
    case "share_count":
      return "One instrument only";
    case "market_price":
      return "One instrument only";
  }
}

/**
 * The headline figure's formatting.
 *
 * A share count is not money and a price is never rounded to whole
 * dollars, so the metric picks the formatter rather than every call site
 * assuming USD.
 */
export function formatMetricValue(metric: Metric, value: number): string {
  if (metric === "share_count") return formatShares(value);
  if (metric === "market_price") {
    return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return formatUsd(value);
}

// ─── Conflict resolution ──────────────────────────────────────

export type ScopeDimension = "instrument" | "account";

/** The shape the resolver needs: the two scope slots and the metric. Kept
 * structural so it applies to a whole `ViewState` without this module
 * having to know what else is in one. */
export interface MetricScopeState {
  instrumentId: string | null;
  accountId: string | null;
  metric: Metric;
}

export type MetricChoice<S extends MetricScopeState> =
  | { selectable: false; reason: string }
  | {
      selectable: true;
      /** The state to move to — the same object with the metric applied and
       * any dimension the metric doesn't have cleared. */
      next: S;
      /** Chips this choice silently dismissed, in chip order. */
      cleared: ScopeDimension[];
      /** Toast copy when something was cleared, `null` when nothing was.
       * `null` is the signal to use the plain `update` path — an ordinary
       * metric switch is not something to offer back. */
      undoMessage: string | null;
    };

/** Why `share_count` / `market_price` cannot be picked from a wider view. */
export const NEEDS_INSTRUMENT_REASON = "Pick an instrument first";

function clearedMessage(metric: Metric, cleared: ScopeDimension[]): string {
  const chips = cleared
    .map((d) => (d === "instrument" ? "Instrument" : "Account"))
    .join(" and ");
  const dimensions = cleared.map((d) => `${d} dimension`).join(" or ");
  return `${chips} filter removed — ${metricLabel(metric).toLowerCase()} has no ${dimensions}`;
}

/**
 * Apply a metric to a scope, resolving any conflict.
 *
 * Total by construction: the "needs a dimension you lack" half is the only
 * unselectable outcome, and every selectable outcome has already had the
 * offending chip removed.
 */
export function resolveMetricChoice<S extends MetricScopeState>(
  state: S,
  metric: Metric,
): MetricChoice<S> {
  if (metricRequiresInstrument(metric) && state.instrumentId === null) {
    return { selectable: false, reason: NEEDS_INSTRUMENT_REASON };
  }

  const cleared: ScopeDimension[] = [];
  let next: S = { ...state, metric };

  if (state.instrumentId !== null && !metricHasInstrumentDimension(metric)) {
    next = { ...next, instrumentId: null };
    cleared.push("instrument");
  }
  if (state.accountId !== null && !metricHasAccountDimension(metric)) {
    next = { ...next, accountId: null };
    cleared.push("account");
  }

  return {
    selectable: true,
    next,
    cleared,
    undoMessage: cleared.length === 0 ? null : clearedMessage(metric, cleared),
  };
}

/**
 * Repair a metric that has been left without the instrument it needs.
 *
 * Dismissing the instrument chip while on `share_count` or `market_price`
 * would otherwise land on a state the Metric sheet refuses to offer — a
 * price summed across every instrument you hold, reachable by a different
 * door. The metric falls back to `equity`, the same repair
 * `selectInstrument` already makes in the other direction.
 */
export function repairMetricForScope<S extends MetricScopeState>(state: S): S {
  if (metricRequiresInstrument(state.metric) && state.instrumentId === null) {
    return { ...state, metric: "equity" };
  }
  return state;
}

// ─── Sheet rows ───────────────────────────────────────────────

export interface MetricOption {
  metric: Metric;
  label: string;
  /** The metric's own note, extended with the consequence of picking it —
   * the reason it is disabled, or which chip it will clear. Nothing
   * happens silently that the row did not warn about. */
  note: string;
  selected: boolean;
  disabled: boolean;
}

export function buildMetricOptions(
  state: MetricScopeState,
): MetricOption[] {
  return METRICS.map((metric) => {
    const choice = resolveMetricChoice(state, metric);
    const base = metricNote(metric);
    if (!choice.selectable) {
      return {
        metric,
        label: metricLabel(metric),
        note: `${base} — ${choice.reason.toLowerCase()}`,
        selected: state.metric === metric,
        disabled: true,
      };
    }
    const suffix = choice.cleared.length
      ? ` — clears the ${choice.cleared.join(" and ")} filter`
      : "";
    return {
      metric,
      label: metricLabel(metric),
      note: `${base}${suffix}`,
      selected: state.metric === metric,
      disabled: false,
    };
  });
}
