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
import {
  metricHasAccountDimension,
  metricHasInstrumentDimension,
  repairMetricForScope,
  type Metric,
} from "./metrics";
import type { Granularity, RangeKey } from "./timeseries";

export type { Metric };

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
  /** Explicit bounds for `rangeKey: "Custom"`, as `YYYY-MM-DD`. Kept as
   * plain strings so a `ViewState` stays comparable and snapshottable —
   * two `Date` objects for the same day are never `===`. */
  customRange: { start: string; end: string } | null;
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
  customRange: null,
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
 * say. Only with no instrument in scope, though: `cash_balance` has no
 * instrument dimension, so firing it at slice level would build the very
 * query auto-adjustment 4 exists to prevent, *and* would answer a
 * different question than the one the instrument chip is asking.
 *
 * The converse is the prototype's own repair in `gotoAcct` and is kept:
 * arriving at an account that *does* hold instruments while on
 * `cash_balance` switches back to `equity`. Without it, one visit to a
 * cash-only account would leave every later account showing its cash
 * balance with no way back.
 *
 * The first repair is the mirror of auto-adjustment 2 and #18's Accounts
 * sheet is what made it reachable: `market_price` has no account
 * dimension, so picking an account while on it is a query the API rejects
 * outright. Silent, like its counterpart — the alternative is refusing a
 * selection the user can see is legitimate.
 */
export function selectAccount(
  state: ViewState,
  accountId: string,
  options: { holdsInstruments: boolean },
): ViewState {
  let metric = state.metric;
  if (!metricHasAccountDimension(metric)) {
    metric = "equity";
  }
  if (
    state.instrumentId === null &&
    !options.holdsInstruments &&
    HOLDING_METRICS.includes(metric)
  ) {
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
 *
 * `repairMetricForScope` covers the one case where dropping the chip is
 * not enough: `share_count` and `market_price` are a single instrument's
 * properties, and the Metric sheet refuses to offer them without one. A
 * chip dismissal must not be a back door into the state the sheet is
 * guarding.
 */
export function clearInstrument(state: ViewState): ViewState {
  return repairMetricForScope({ ...state, instrumentId: null });
}

/** Dismiss the account chip. slice → instrument, account → portfolio. */
export function clearAccount(state: ViewState): ViewState {
  return { ...state, accountId: null };
}

/**
 * The scope after an account was deleted (#24 AC 7).
 *
 * Not `clearAccount` with an `if` at the call site, and not an Undo toast
 * either. Both would be wrong in the same way: this is not a filter the
 * user dismissed and might want back — the thing the chip named no longer
 * exists, so offering to restore the scope would be offering a filter on a
 * deleted account. The view falls back to the whole portfolio silently and
 * the deletion itself is what was confirmed.
 *
 * Returns the state **unchanged** when the deleted account wasn't the one
 * in scope, so a caller can apply it unconditionally — the same shape
 * `clampSelection` (`lib/chartInteraction.ts`) uses for the analogous "the
 * data moved under the selection" case, and the reason both are pure: the
 * transition is easy to get subtly wrong and impossible to see.
 *
 * The instrument chip is deliberately left alone. An instrument is not
 * owned by an account: at slice level this is exactly the slice → instrument
 * step, and the user still holds that instrument elsewhere.
 */
export function accountDeleted(
  state: ViewState,
  deletedAccountId: string,
): ViewState {
  if (state.accountId !== deletedAccountId) return state;
  return clearAccount(state);
}

/**
 * A tap on the Grid — a matrix cell, a row header, a column header or an
 * allocation segment — as a scope.
 *
 * The Grid answers "where is everything" for the whole portfolio, so its
 * taps *set* the scope rather than deepening it: a cell is a slice, a row
 * header is that instrument across all accounts, a column header is that
 * account. Anything the Portfolio tab happened to have selected is
 * replaced, which is the prototype's own intent — its `slice(sym, acct)`
 * passes `acct` even when null, and its column tap declares
 * `level: 'account'` outright.
 *
 * Composed from the two ordinary transitions rather than assembling a
 * `ViewState` directly, so every auto-adjustment applies exactly as it
 * does on the Portfolio tab (behaviour.md § Auto-adjustments). An account
 * only ever gets a column here by holding an instrument, so
 * `holdsInstruments` is true by construction — the empty-account repair
 * has nothing to fire on.
 */
export function selectFromGrid(
  state: ViewState,
  target: { instrumentId: string | null; accountId: string | null },
): ViewState {
  const cleared = clearAccount(clearInstrument(state));
  const withInstrument =
    target.instrumentId === null
      ? cleared
      : selectInstrument(cleared, target.instrumentId);
  return target.accountId === null
    ? withInstrument
    : selectAccount(withInstrument, target.accountId, {
        holdsInstruments: true,
      });
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
