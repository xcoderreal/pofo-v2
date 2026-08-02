import { useMemo } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { usePortfolioSeries } from "@/hooks/usePortfolio";
import { usePositions } from "@/hooks/usePositions";
import type { ChartPoint } from "@/lib/chart";
import { firstError } from "@/lib/dashboard";
import {
  buildAllocation,
  buildGridTotal,
  buildMatrix,
  type AllocationSegment,
  type GridTotal,
  type Matrix,
} from "@/lib/grid";
import {
  buildAccountRows,
  combineAccountSeries,
  pointsByGroup,
  sumSeries,
  type AccountRow,
} from "@/lib/positions";
import { fromApiDate, resolveRange, toApiDate } from "@/lib/timeseries";

/**
 * The Grid's range is fixed at one year and does **not** follow the
 * Portfolio tab's range pills.
 *
 * The tab answers "where is everything", not "how has it moved" — the
 * ticket asks for the total's "change over the past year" outright, and
 * the matrix and allocation bar are cross-sectional and have no range at
 * all. A range control here would move exactly two of the four sections.
 */
const GRID_RANGE = "1Y" as const;

/**
 * Sparklines are drawn weekly rather than at the span's auto-granularity.
 *
 * `autoGranularity(366)` is monthly, and twelve points render as a
 * polygon rather than a trend. A sparkline is read as a shape, so it gets
 * the density that makes it one; ~53 points per account is nothing.
 */
const GRID_GRANULARITY = "weekly" as const;

export interface GridAccountRow extends AccountRow {
  /** The account's own value-including-cash series, ready for
   * `buildPath`. Empty for an account with no history in the range. */
  spark: ChartPoint[];
}

export interface Grid {
  total: GridTotal;
  allocation: AllocationSegment[];
  matrix: Matrix;
  accounts: GridAccountRow[];
  isPending: boolean;
  errorMessage: string | null;
}

/**
 * Everything the Grid screen renders.
 *
 * Three queries, and deliberately not more:
 *
 * - **one** batched positions call, which every figure on the screen is a
 *   pivot of — the total tile, the allocation bar, the matrix and each
 *   account's current value (docs/adr/0001-dashboard-v2.md § 5);
 * - **two** grouped-by-account series, `equity` and `cash_balance`, which
 *   are separate only because `equity` excludes CASH so the two can be
 *   added without double-counting (§ 3). Every sparkline comes from those
 *   two responses — not one query per account — and the total tile's
 *   opening value is their sum, so it costs nothing extra.
 *
 * Composed in a screen-level hook for the same reason `useDashboard` is:
 * the sections share their queries and differ only in which pivot they
 * take, and the page staying thin is the point (CLAUDE.md).
 */
export function useGrid(): Grid {
  const today = useMemo(() => new Date(), []);
  const range = useMemo(() => {
    const resolved = resolveRange(GRID_RANGE, today);
    return { start: toApiDate(resolved.start), end: toApiDate(resolved.end) };
  }, [today]);

  const positions = usePositions();
  const instruments = useInstruments();
  const accounts = useAccounts();

  const seriesQuery = {
    start: range.start,
    end: range.end,
    granularity: GRID_GRANULARITY,
    mode: "point_in_time" as const,
    groupBy: "account" as const,
  };
  const equityByAccount = usePortfolioSeries({
    ...seriesQuery,
    metric: "equity",
  });
  const cashByAccount = usePortfolioSeries({
    ...seriesQuery,
    metric: "cash_balance",
  });

  const pointsByAccount = useMemo(
    () =>
      combineAccountSeries(
        pointsByGroup(equityByAccount.data),
        pointsByGroup(cashByAccount.data),
      ),
    [equityByAccount.data, cashByAccount.data],
  );

  const accountRows = useMemo(
    () =>
      buildAccountRows({
        positions: positions.data,
        accounts: accounts.data,
        pointsByAccount,
        rangeStart: range.start,
        // The Grid's range always ends today, so the positions endpoint's
        // figures *are* the range-end figures (see `rowChangePercent`).
        currentValueIsRangeEnd: true,
      }).map((row) => ({
        ...row,
        spark: (pointsByAccount[row.accountId] ?? []).map((point) => ({
          timestamp: fromApiDate(point.timestamp),
          value: point.value,
        })),
      })),
    [positions.data, accounts.data, pointsByAccount, range.start],
  );

  const total = useMemo(
    () =>
      buildGridTotal({
        positions: positions.data,
        points: sumSeries(pointsByAccount),
        rangeStart: range.start,
      }),
    [positions.data, pointsByAccount, range.start],
  );

  const matrix = useMemo(
    () =>
      buildMatrix({
        positions: positions.data,
        instruments: instruments.data,
        accounts: accounts.data,
      }),
    [positions.data, instruments.data, accounts.data],
  );

  return {
    total,
    allocation: useMemo(() => buildAllocation(accountRows), [accountRows]),
    matrix,
    accounts: accountRows,
    isPending:
      positions.isPending ||
      instruments.isPending ||
      accounts.isPending ||
      equityByAccount.isPending ||
      cashByAccount.isPending,
    errorMessage: firstError([
      positions.error?.message,
      instruments.error?.message,
      accounts.error?.message,
      equityByAccount.error?.message,
      cashByAccount.error?.message,
    ]),
  };
}
