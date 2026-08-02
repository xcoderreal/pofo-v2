/**
 * The Grid tab's derivations: the total tile, the allocation bar and the
 * instrument × account matrix.
 *
 * Zero React imports by design (see CLAUDE.md). The matrix in particular
 * belongs here rather than in a component: the guarantee the ticket
 * actually makes — **nothing is truncated** — is a property of the pivot,
 * not of the rendering, and the only way to prove it is to feed the pivot
 * an input wider and taller than any seeded portfolio and count what comes
 * out. The prototype's hardcoded 4 accounts × 7 instruments is exactly the
 * bug this file is written to make impossible
 * (docs/design/dashboard_v2/behaviour.md § Grid).
 *
 * Every figure is a pivot of `/portfolio/positions` rows, which is why the
 * time-series query interface never grew a two-dimensional `group_by`
 * (docs/adr/0001-dashboard-v2.md § 5).
 */

import {
  changePercent,
  openingValue,
  type AccountRow,
  type AccountSummary,
  type InstrumentSummary,
  type PositionRow,
  type RangePoint,
} from "./positions";

const CASH_ASSET_CLASS = "cash";

// ─── Total tile ───────────────────────────────────────────────

export interface GridTotal {
  /**
   * `equity + cash_balance`, and the two do not overlap: trades auto-post
   * a CASH leg and `equity` excludes CASH at `"all"` scope, so summing
   * every position row's market value counts each dollar exactly once
   * (docs/adr/0001-dashboard-v2.md §§ 1 and 3).
   *
   * null while any holding is still unpriced — a partial total presented
   * as the whole is worse than no figure.
   */
  value: number | null;
  /** Absolute move across the range, null when there is no opening to
   * measure from. */
  change: number | null;
  changePercent: number | null;
}

/**
 * The headline tile: what everything is worth now, and how it moved.
 *
 * The current figure comes from the batched positions endpoint and the
 * opening from the summed per-account series, which is the same split the
 * Portfolio tab's list rows use — the endpoint takes no date, so it can
 * only ever supply "now" (see `rowChangePercent`). The Grid's range always
 * ends today, so "now" is always the range end here.
 */
export function buildGridTotal(args: {
  positions: readonly PositionRow[] | undefined;
  /** The whole portfolio's range-scoped series — `sumSeries` over the
   * per-account series the sparklines are already drawn from. */
  points: readonly RangePoint[] | undefined;
  rangeStart: string;
}): GridTotal {
  const { positions, points, rangeStart } = args;

  let value: number | null = 0;
  for (const row of positions ?? []) {
    value = addNullable(
      value,
      row.market_value === null ? null : Number(row.market_value),
    );
  }

  const opening = openingValue(points, rangeStart);
  return {
    value,
    change: opening === null || value === null ? null : value - opening,
    changePercent:
      opening === null || value === null ? null : changePercent(opening, value),
  };
}

// ─── Allocation bar ───────────────────────────────────────────

export interface AllocationSegment {
  accountId: string;
  label: string;
  value: number;
  /** Share of the bar, 0–100. Segments sum to 100 by construction. */
  percent: number;
}

/** Below this an account's value is rounding dust rather than a slice of
 * the portfolio — the prototype's own threshold. A zero-width segment
 * with a "0%" legend entry is noise in both places it appears. */
const SEGMENT_THRESHOLD = 1;

/**
 * The segmented bar, by account, from the rows the Accounts list already
 * builds.
 *
 * Percentages are taken against the sum of the segments *shown*, not
 * against the portfolio total, so the bar fills its width and the legend
 * adds to 100. The two differ only by the dust excluded above.
 *
 * An account whose value is unknown (an unpriced holding) is excluded
 * rather than treated as zero: it would silently inflate every other
 * account's share.
 */
export function buildAllocation(
  rows: readonly AccountRow[],
): AllocationSegment[] {
  const held = rows.filter(
    (row): row is AccountRow & { value: number } =>
      row.value !== null && row.value > SEGMENT_THRESHOLD,
  );
  const total = held.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return [];

  return held
    .map((row) => ({
      accountId: row.accountId,
      label: row.name,
      value: row.value,
      percent: (row.value / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);
}

// ─── Instrument × account matrix ──────────────────────────────

export interface MatrixCell {
  accountId: string;
  /**
   * Whether this account holds this instrument at all. `false` renders as
   * a dot and is **not tappable** — there is no slice to open, and a
   * pressable that leads to an empty screen is worse than a static one.
   */
  held: boolean;
  /** Market value of the slice; null when held but not yet priced. */
  value: number | null;
}

export interface MatrixRow {
  instrumentId: string;
  symbol: string;
  /** Value across every column — the row's sort key. */
  total: number | null;
  /** One cell per column, in column order. */
  cells: MatrixCell[];
}

export interface MatrixColumn {
  accountId: string;
  label: string;
  /** Value of every instrument in this account — the column's sort key. */
  total: number | null;
}

export interface Matrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
}

/**
 * Instruments down, accounts across, slice value in each cell.
 *
 * Two membership rules, both explicit (behaviour.md § Grid):
 *
 * - **A row for every instrument with a live position.** No cap. The
 *   prototype's `.slice(0, 7)` had no rule behind it, and a matrix that
 *   silently drops your eighth holding is worse than one that scrolls.
 * - **A column for every account holding at least one instrument.** A
 *   cash-only or empty account's column would be entirely dots, so it is
 *   omitted — the prototype's hardcoded `['a1','a2','a3','a4']` implied
 *   this and never said it.
 *
 * "Live" means non-zero shares, matching `splitClosed`: a fully closed
 * position is not a holding, and its whole row (or column) would be dots
 * with a $0 somewhere in it. CASH is excluded as an instrument for the
 * reason it is excluded everywhere else — it is the total tile's other
 * half, not a holding (docs/adr/0001-dashboard-v2.md § 3).
 *
 * Both axes sort by value, largest first, so the biggest position sits
 * next to the pinned symbol column. Unpriced totals sort last rather than
 * as zero, the same convention as every other list.
 */
export function buildMatrix(args: {
  positions: readonly PositionRow[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
  accounts: readonly AccountSummary[] | undefined;
}): Matrix {
  const { positions, instruments, accounts } = args;
  const instrumentCatalog = new Map((instruments ?? []).map((i) => [i.id, i]));
  const accountCatalog = new Map((accounts ?? []).map((a) => [a.id, a]));

  const live = (positions ?? []).filter(
    (row) =>
      instrumentCatalog.get(row.instrument_id)?.asset_class !==
        CASH_ASSET_CLASS && Number(row.share_count) !== 0,
  );

  const cells = new Map<string, number | null>();
  const instrumentTotals = new Map<string, number | null>();
  const accountTotals = new Map<string, number | null>();

  for (const row of live) {
    const value = row.market_value === null ? null : Number(row.market_value);
    cells.set(cellKey(row.instrument_id, row.account_id), value);
    accumulate(instrumentTotals, row.instrument_id, value);
    accumulate(accountTotals, row.account_id, value);
  }

  const columns: MatrixColumn[] = [...accountTotals.entries()]
    .map(([accountId, total]) => ({
      accountId,
      label: accountCatalog.get(accountId)?.name ?? accountId,
      total,
    }))
    .sort(byTotalDescending);

  const rows: MatrixRow[] = [...instrumentTotals.entries()]
    .map(([instrumentId, total]) => ({
      instrumentId,
      symbol:
        instrumentCatalog.get(instrumentId)?.symbol ?? instrumentId.toUpperCase(),
      total,
      cells: columns.map((column) => {
        const key = cellKey(instrumentId, column.accountId);
        return {
          accountId: column.accountId,
          held: cells.has(key),
          value: cells.get(key) ?? null,
        };
      }),
    }))
    .sort(byTotalDescending);

  return { columns, rows };
}

function cellKey(instrumentId: string, accountId: string): string {
  // The pair is the positions endpoint's own key, so a delimiter that
  // cannot appear in either id is enough — ids are slugs.
  return `${instrumentId} ${accountId}`;
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a + b;
}

/** `has` rather than `??`, so an already-null total (one unpriced
 * holding) stays null instead of resetting to zero. */
function accumulate(
  totals: Map<string, number | null>,
  key: string,
  value: number | null,
): void {
  const running = totals.has(key) ? (totals.get(key) ?? null) : 0;
  totals.set(key, addNullable(running, value));
}

function byTotalDescending(
  a: { total: number | null },
  b: { total: number | null },
): number {
  return (b.total ?? -1) - (a.total ?? -1);
}
