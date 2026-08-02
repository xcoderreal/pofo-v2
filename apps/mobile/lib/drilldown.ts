/**
 * The Portfolio tab's four levels, and the view state they are derived from.
 *
 * The dashboard is one screen, not four routes: "whole portfolio", "one
 * account", "one instrument" and "one instrument in one account" are the
 * same structure answering a narrower question. Which of the two scope
 * slots is filled *is* the level — there is no separate `level` field to
 * keep in sync (docs/design/dashboard_v2/behaviour.md § Navigation and
 * scope).
 *
 * Zero React imports by design (see CLAUDE.md). Every transition below is
 * a pure `ViewState -> ViewState` function, so the silent auto-adjustments
 * — the part that is easy to get wrong and impossible to see — are covered
 * by `bun test` rather than by clicking through a rendered screen.
 */

import type { components } from "./api-types";
import type { Granularity, RangeKey } from "./timeseries";

export type Metric = components["schemas"]["Metric"];

/** Which list the portfolio level is showing. Only meaningful at that
 * level: every narrower level has exactly one list. */
export type ListTab = "holdings" | "accounts";

export type Level = "portfolio" | "account" | "instrument" | "slice";

export interface Scope {
  instrumentId: string | null;
  accountId: string | null;
}

/**
 * Everything the Undo toast restores.
 *
 * Clearing a filter snapshots *all* of this, not just the chip that was
 * dismissed (docs/design/dashboard_v2/behaviour.md § Undo toast) — level
 * and scope, but also metric, range, granularity, tab and the cumulative
 * flag, because an auto-adjustment may have quietly changed any of them
 * on the way in.
 */
export interface ViewState extends Scope {
  metric: Metric;
  rangeKey: RangeKey;
  /** null = whatever `autoGranularity` picks for the resolved span. An
   * explicit choice is per-range and is dropped when the range changes. */
  granularity: Granularity | null;
  tab: ListTab;
  /** `realized_gain`'s per-period vs cumulative toggle (#19). Carried
   * here because Undo has to restore it even though nothing sets it yet. */
  cumulative: boolean;
}

export const INITIAL_VIEW_STATE: ViewState = {
  instrumentId: null,
  accountId: null,
  metric: "equity",
  rangeKey: "1Y",
  granularity: null,
  tab: "holdings",
  cumulative: false,
};

/**
 * The level, read straight off the scope.
 *
 * | Instrument | Account | Level |
 * |---|---|---|
 * | — | — | `portfolio` |
 * | — | set | `account` |
 * | set | — | `instrument` |
 * | set | set | `slice` |
 */
export function resolveLevel(scope: Scope): Level {
  if (scope.instrumentId !== null && scope.accountId !== null) return "slice";
  if (scope.instrumentId !== null) return "instrument";
  if (scope.accountId !== null) return "account";
  return "portfolio";
}

// ─── Metric dimensions ────────────────────────────────────────
// The query interface rejects a scope dimension a metric doesn't have —
// deliberately, "rather than silently ignoring it" (docs/domain-model.md
// § Query interface). So the client has to know which dimensions each
// metric carries before it builds a request. Acting on a mismatch by
// clearing a chip is #18's job; not *sending* the impossible filter is
// this module's.

const NO_INSTRUMENT_DIMENSION: readonly Metric[] = ["cash_balance"];
const NO_ACCOUNT_DIMENSION: readonly Metric[] = ["market_price"];

export function metricHasInstrumentDimension(metric: Metric): boolean {
  return !NO_INSTRUMENT_DIMENSION.includes(metric);
}

export function metricHasAccountDimension(metric: Metric): boolean {
  return !NO_ACCOUNT_DIMENSION.includes(metric);
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

/**
 * The scope filters to send with a query for this state.
 *
 * A dimension the metric doesn't have is omitted rather than sent — the
 * API answers that with a 400. `cash_balance` at slice level is the
 * reachable case: the account is what's being asked about and the
 * instrument slot is irrelevant to the answer.
 */
export function scopeParams(state: ViewState): {
  instruments?: string[];
  accounts?: string[];
} {
  const params: { instruments?: string[]; accounts?: string[] } = {};
  if (state.instrumentId !== null && metricHasInstrumentDimension(state.metric)) {
    params.instruments = [state.instrumentId];
  }
  if (state.accountId !== null && metricHasAccountDimension(state.metric)) {
    params.accounts = [state.accountId];
  }
  return params;
}

// ─── Transitions ──────────────────────────────────────────────

/** Metrics that measure holdings, so an account with none of them has
 * nothing to chart under them. */
const HOLDING_METRICS: readonly Metric[] = [
  "equity",
  "cost_basis",
  "unrealized_gain",
];

/**
 * Drill into an instrument — from a Holdings row, a Grid cell or a search
 * slice. Deepens portfolio → instrument and account → slice.
 *
 * Auto-adjustment 2 (behaviour.md § Auto-adjustments): `cash_balance` has
 * no instrument dimension, so selecting one silently switches back to
 * `equity`. Silent and intentional — the alternative is a chart that
 * cannot answer the question the user just asked.
 */
export function selectInstrument(
  state: ViewState,
  instrumentId: string,
): ViewState {
  return {
    ...state,
    instrumentId,
    metric: state.metric === "cash_balance" ? "equity" : state.metric,
    tab: "holdings",
  };
}

/**
 * Drill into an account. Deepens portfolio → account and instrument →
 * slice.
 *
 * Auto-adjustment 1 (behaviour.md § Auto-adjustments): an account holding
 * no instruments has a flat zero under every holdings metric, so the
 * metric switches to `cash_balance` — the only thing that account has to
 * say.
 *
 * The converse is the prototype's own repair in `gotoAcct` and is kept:
 * arriving at an account that *does* hold instruments while on
 * `cash_balance` switches back to `equity`. Without it, one visit to a
 * cash-only account would leave every later account showing its cash
 * balance with no way back until the metric sheet lands in #18.
 */
export function selectAccount(
  state: ViewState,
  accountId: string,
  options: { holdsInstruments: boolean },
): ViewState {
  let metric = state.metric;
  if (!options.holdsInstruments && HOLDING_METRICS.includes(metric)) {
    metric = "cash_balance";
  } else if (options.holdsInstruments && metric === "cash_balance") {
    metric = "equity";
  }
  return { ...state, accountId, metric, tab: "holdings" };
}

/**
 * Dismiss the instrument chip. slice → account, instrument → portfolio.
 *
 * The level follows from the scope, so there is nothing else to unwind.
 * The caller is what raises the Undo toast — see `useViewState`.
 */
export function clearInstrument(state: ViewState): ViewState {
  return { ...state, instrumentId: null };
}

/** Dismiss the account chip. slice → instrument, account → portfolio. */
export function clearAccount(state: ViewState): ViewState {
  return { ...state, accountId: null };
}

// ─── Chips ────────────────────────────────────────────────────

export interface ScopeChip {
  kind: "instrument" | "account";
  /** What the chip says — a symbol, or an account's name. */
  label: string;
}

type InstrumentSummary = components["schemas"]["InstrumentResponse"];
type AccountSummary = components["schemas"]["AccountResponse"];

/**
 * The dismissible chips for a scope, instrument first.
 *
 * Falls back to the raw id when the catalog hasn't loaded yet: a chip
 * that says `goog` is worse than one that says `GOOG`, but a scope with
 * no visible chip at all is a trap — the list would be filtered with
 * nothing on screen explaining why, and no control to undo it.
 */
export function buildChips(args: {
  scope: Scope;
  instruments: readonly InstrumentSummary[] | undefined;
  accounts: readonly AccountSummary[] | undefined;
}): ScopeChip[] {
  const { scope, instruments, accounts } = args;
  const chips: ScopeChip[] = [];

  if (scope.instrumentId !== null) {
    const instrument = (instruments ?? []).find(
      (i) => i.id === scope.instrumentId,
    );
    chips.push({
      kind: "instrument",
      label: instrument?.symbol ?? scope.instrumentId.toUpperCase(),
    });
  }
  if (scope.accountId !== null) {
    const account = (accounts ?? []).find((a) => a.id === scope.accountId);
    chips.push({ kind: "account", label: account?.name ?? scope.accountId });
  }
  return chips;
}
