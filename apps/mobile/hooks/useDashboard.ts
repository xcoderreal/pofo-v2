import { useMemo } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { usePortfolioSeries } from "@/hooks/usePortfolio";
import { usePortfolioSummary } from "@/hooks/usePortfolioSummary";
import { usePositions } from "@/hooks/usePositions";
import { buildAccountOptions, type AccountOption } from "@/lib/accounts";
import type { ChartPoint } from "@/lib/chart";
import {
  buildHeadline,
  firstError,
  listVisibility,
  resolveDashboardRange,
  toChartPoints,
  type DashboardRange,
  type Headline,
} from "@/lib/dashboard";
import {
  buildChips,
  scopeParams,
  type Level,
  type ScopeChip,
  type ViewState,
} from "@/lib/drilldown";
import { metricMode } from "@/lib/metrics";
import {
  accountHoldsInstruments,
  buildAccountRows,
  buildHoldingRows,
  buildInstrumentAccountRows,
  buildInstrumentStats,
  cashBalanceFor,
  combineAccountSeries,
  pointsByGroup,
  splitClosed,
  type AccountRow,
  type HoldingRow,
  type InstrumentAccountRow,
  type InstrumentStats,
} from "@/lib/positions";
import { fromApiDate } from "@/lib/timeseries";

/** Below this, an account's cash is rounding dust rather than a balance
 * worth its own row — the prototype's own threshold. */
const CASH_ROW_THRESHOLD = 1;

export interface DashboardChart {
  points: ChartPoint[];
  headline: Headline;
  isPending: boolean;
  errorMessage: string | null;
}

export interface DashboardLists {
  holdings: { live: HoldingRow[]; closed: HoldingRow[] };
  accounts: AccountRow[];
  breakdown: { live: InstrumentAccountRow[]; closed: InstrumentAccountRow[] };
  isPending: boolean;
  errorMessage: string | null;
}

export interface Dashboard {
  range: DashboardRange;
  chart: DashboardChart;
  lists: DashboardLists;
  /** The instrument-level stat card's figures, null at every other level. */
  stats: InstrumentStats | null;
  /** The account level's cash row, null when there is no balance worth
   * showing (or at any other level). */
  cash: { value: number; subtitle: string } | null;
  /** An account with no holdings — live or closed — and no cash. Its
   * equity series would be a flat zero, which reads as a broken screen
   * rather than as an empty one. */
  accountIsEmpty: boolean;
  chips: ScopeChip[];
  accountOptions: AccountOption[];
  /** Auto-adjustment 1's predicate, bound to the loaded catalogs so the
   * screen doesn't have to hold either (behaviour.md § Auto-adjustments). */
  accountHoldsInstruments: (accountId: string) => boolean;
}

/**
 * Everything the Portfolio screen renders, from its view state.
 *
 * A screen-level hook rather than one per resource, which is a
 * deliberate widening of CLAUDE.md § "hooks/ = data hooks": the four
 * levels share one set of queries and differ only in which subset is
 * enabled, so splitting them per resource would put that cascade back in
 * the page — and the page being thin is the point. The per-resource
 * hooks it composes (`usePositions`, `usePortfolioSeries`, …) stay
 * exactly as they are and remain usable on their own.
 */
export function useDashboard(state: ViewState, level: Level): Dashboard {
  // A single "today" for the render, so the resolved range and every
  // label derived from it agree with each other.
  const today = useMemo(() => new Date(), []);

  const summary = usePortfolioSummary();
  const earliest = summary.data?.earliest_transaction_date ?? null;

  const range = useMemo(
    () =>
      resolveDashboardRange({
        rangeKey: state.rangeKey,
        customRange: state.customRange,
        granularity: state.granularity,
        today,
        earliest: earliest === null ? null : fromApiDate(earliest),
      }),
    [state.rangeKey, state.customRange, state.granularity, today, earliest],
  );

  const rangeWindow = {
    start: range.startDate,
    end: range.endDate,
    granularity: range.granularity,
  };
  const listQuery = {
    // The lists' denominators are always about *value*, whatever the
    // chart above them is plotting — a row's percentage is the change in
    // what it is worth (behaviour.md § Percentages).
    metric: "equity" as const,
    ...rangeWindow,
    mode: "point_in_time" as const,
  };

  const instruments = useInstruments();
  const accounts = useAccounts();

  // One unscoped positions call feeds every level. The rows are keyed by
  // (account, instrument), so narrowing is a filter rather than a
  // refetch — which is what makes drilling in instant and keeps the
  // stat card, the lists and (from #20) the Grid matrix reading the same
  // batched call (docs/adr/0001-dashboard-v2.md § 5).
  const positions = usePositions();
  const scopedPositions = useMemo(
    () =>
      (positions.data ?? []).filter(
        (row) =>
          (state.accountId === null || row.account_id === state.accountId) &&
          (state.instrumentId === null ||
            row.instrument_id === state.instrumentId),
      ),
    [positions.data, state.accountId, state.instrumentId],
  );

  // A Level is queried at an instant and a Flow over an interval; the API
  // rejects the wrong pairing (docs/domain-model.md § (Metric, Mode)
  // validity), so the mode follows the metric rather than being fixed.
  const series = usePortfolioSeries({
    metric: state.metric,
    ...rangeWindow,
    mode: metricMode(state.metric, state.cumulative),
    groupBy: "none",
    ...scopeParams(state),
  });

  // Row percentages are range-scoped, so the lists re-fetch with the
  // range exactly as the header does: the positions endpoint supplies
  // each row's current value, and these grouped series supply the
  // denominator it is measured against.
  //
  // Which grouping is needed depends on the level — by instrument for a
  // holdings list, by account for the instrument level's breakdown — and
  // each is gated on being on screen. react-query caches, so stepping
  // back up a level is free.
  const visible = listVisibility(level, state.tab);

  const byInstrument = usePortfolioSeries(
    {
      ...listQuery,
      groupBy: "instrument",
      accounts: state.accountId ? [state.accountId] : undefined,
      instruments: state.instrumentId ? [state.instrumentId] : undefined,
    },
    { enabled: visible.holdings },
  );
  // The Accounts tab needs value *including* cash, which is two queries —
  // `equity` deliberately excludes CASH so the two can be added without
  // double-counting (docs/adr/0001-dashboard-v2.md § 3).
  const equityByAccount = usePortfolioSeries(
    { ...listQuery, groupBy: "account" },
    { enabled: visible.accounts },
  );
  const cashByAccount = usePortfolioSeries(
    { ...listQuery, metric: "cash_balance", groupBy: "account" },
    { enabled: visible.accounts },
  );
  const byAccountForInstrument = usePortfolioSeries(
    {
      ...listQuery,
      groupBy: "account",
      instruments: state.instrumentId ? [state.instrumentId] : undefined,
    },
    { enabled: visible.breakdown },
  );

  // ─── Rows ───────────────────────────────────────────────────

  const holdingRows = useMemo(
    () =>
      buildHoldingRows({
        positions: scopedPositions,
        instruments: instruments.data,
        pointsByInstrument: pointsByGroup(byInstrument.data),
        rangeStart: range.startDate,
        currentValueIsRangeEnd: range.endsToday,
      }),
    [scopedPositions, instruments.data, byInstrument.data, range],
  );
  const holdings = useMemo(() => splitClosed(holdingRows), [holdingRows]);

  const accountRows = useMemo(
    () =>
      buildAccountRows({
        positions: positions.data,
        accounts: accounts.data,
        pointsByAccount: combineAccountSeries(
          pointsByGroup(equityByAccount.data),
          pointsByGroup(cashByAccount.data),
        ),
        rangeStart: range.startDate,
        currentValueIsRangeEnd: range.endsToday,
      }),
    [
      positions.data,
      accounts.data,
      equityByAccount.data,
      cashByAccount.data,
      range,
    ],
  );

  const breakdown = useMemo(
    () =>
      splitClosed(
        state.instrumentId === null
          ? []
          : buildInstrumentAccountRows({
              positions: scopedPositions,
              accounts: accounts.data,
              instrumentId: state.instrumentId,
              pointsByAccount: pointsByGroup(byAccountForInstrument.data),
              rangeStart: range.startDate,
              currentValueIsRangeEnd: range.endsToday,
            }),
      ),
    [
      scopedPositions,
      accounts.data,
      state.instrumentId,
      byAccountForInstrument.data,
      range,
    ],
  );

  const stats = useMemo(
    () =>
      state.instrumentId === null
        ? null
        : buildInstrumentStats(scopedPositions, state.instrumentId),
    [scopedPositions, state.instrumentId],
  );

  const cashValue =
    level === "account" && state.accountId !== null
      ? cashBalanceFor({
          positions: positions.data,
          instruments: instruments.data,
          accountId: state.accountId,
        })
      : null;
  const showCashRow =
    cashValue !== null && Math.abs(cashValue) >= CASH_ROW_THRESHOLD;

  const points = useMemo(() => toChartPoints(series.data), [series.data]);
  const headline = useMemo(
    () =>
      buildHeadline({
        metric: state.metric,
        cumulative: state.cumulative,
        points,
        granularity: range.granularity,
      }),
    [state.metric, state.cumulative, points, range.granularity],
  );

  // ─── Pending / error, per level ─────────────────────────────
  // Only the queries actually enabled for this level are consulted: a
  // disabled react-query sits in `pending` forever, so folding them all
  // together would pin the list on its spinner.

  const listPending =
    positions.isPending ||
    (visible.accounts
      ? accounts.isPending ||
        equityByAccount.isPending ||
        cashByAccount.isPending
      : visible.breakdown
        ? accounts.isPending || byAccountForInstrument.isPending
        : instruments.isPending || byInstrument.isPending);

  const listError = firstError([
    positions.error?.message,
    visible.accounts
      ? (accounts.error?.message ??
        equityByAccount.error?.message ??
        cashByAccount.error?.message)
      : visible.breakdown
        ? (accounts.error?.message ?? byAccountForInstrument.error?.message)
        : (instruments.error?.message ?? byInstrument.error?.message),
  ]);

  const chips = useMemo(
    () =>
      buildChips({
        scope: state,
        instruments: instruments.data,
        accounts: accounts.data,
      }),
    [state, instruments.data, accounts.data],
  );

  const accountOptions = useMemo(
    () =>
      buildAccountOptions({
        accounts: accounts.data,
        positions: positions.data,
        instruments: instruments.data,
        selectedAccountId: state.accountId,
        selectedInstrumentId: state.instrumentId,
      }),
    [
      accounts.data,
      positions.data,
      instruments.data,
      state.accountId,
      state.instrumentId,
    ],
  );

  return {
    range,
    chart: {
      points,
      headline,
      isPending: series.isPending,
      errorMessage: series.isError ? series.error.message : null,
    },
    lists: {
      holdings,
      accounts: accountRows,
      breakdown,
      isPending: listPending,
      errorMessage: listError,
    },
    stats,
    cash:
      showCashRow && cashValue !== null
        ? {
            value: cashValue,
            subtitle: holdings.live.length
              ? "Uninvested"
              : "No instruments in this account",
          }
        : null,
    accountIsEmpty:
      level === "account" &&
      positions.isSuccess &&
      holdingRows.length === 0 &&
      !showCashRow,
    chips,
    accountOptions,
    accountHoldsInstruments: (accountId: string) =>
      accountHoldsInstruments({
        positions: positions.data,
        instruments: instruments.data,
        accountId,
      }),
  };
}
