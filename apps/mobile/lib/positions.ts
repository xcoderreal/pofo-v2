/**
 * Pivoting the batched positions endpoint into the dashboard's lists, and
 * the range-scoped row percentage.
 *
 * Zero React imports by design (see CLAUDE.md) — this is where the two
 * pieces of logic that are easy to get wrong live, so both are covered by
 * `bun test` directly rather than through a rendered screen:
 *
 * 1. **The pivot.** `/portfolio/positions` returns one row per (account,
 *    instrument). Holdings collapses that by instrument, Accounts by
 *    account. Doing it client-side is what keeps the time-series query's
 *    `group_by` single-valued (docs/adr/0001-dashboard-v2.md § 5).
 * 2. **The percentage.** Row percentages are *range-scoped*, not
 *    lifetime: they move with the range pill exactly as the header figure
 *    does. A position that did not exist at the start of the range has no
 *    denominator and renders a dash
 *    (docs/design/dashboard_v2/behaviour.md § Percentages).
 */

import type { components } from "./api-types";

export type PositionRow = components["schemas"]["PositionRowResponse"];
export type SeriesResponse = components["schemas"]["SeriesResponse"];
export type InstrumentSummary = components["schemas"]["InstrumentResponse"];
export type AccountSummary = components["schemas"]["AccountResponse"];

/** A time-series point with its value already parsed. The API sends
 * Decimals as strings so no precision is lost in transit. */
export interface RangePoint {
  /** `YYYY-MM-DD`, which sorts and compares correctly as a string. */
  timestamp: string;
  value: number;
}

export interface HoldingRow {
  instrumentId: string;
  symbol: string;
  name: string;
  shareCount: number;
  /** null while the instrument has no price history yet — distinct from
   * a genuine zero, so the UI can say "pending" rather than "$0". */
  marketValue: number | null;
  realizedGain: number;
  changePercent: number | null;
}

export interface AccountRow {
  accountId: string;
  name: string;
  accountType: string;
  /** Value *including* cash — the Grid's total is `equity + cash_balance`
   * and these are non-overlapping (docs/adr/0001-dashboard-v2.md § 3). */
  value: number | null;
  changePercent: number | null;
}

const CASH_ASSET_CLASS = "cash";

// ─── Series helpers ───────────────────────────────────────────

/** Group a query response by its `group` key, values parsed to numbers. */
export function pointsByGroup(
  series: readonly SeriesResponse[] | undefined,
): Record<string, RangePoint[]> {
  const result: Record<string, RangePoint[]> = {};
  for (const s of series ?? []) {
    result[s.group] = s.points.map((p) => ({
      timestamp: p.timestamp,
      value: Number(p.value),
    }));
  }
  return result;
}

/**
 * Add two sparse series pointwise, treating an absent timestamp as zero.
 *
 * Used to build "account value including cash" from the `equity` and
 * `cash_balance` series. Zero is the right default rather than a skip: an
 * account with cash but no holdings genuinely had zero equity that day,
 * and dropping the timestamp would lose the range-start sample the
 * percentage depends on.
 */
export function addSeries(
  a: readonly RangePoint[] | undefined,
  b: readonly RangePoint[] | undefined,
): RangePoint[] {
  const totals = new Map<string, number>();
  for (const point of a ?? []) {
    totals.set(point.timestamp, (totals.get(point.timestamp) ?? 0) + point.value);
  }
  for (const point of b ?? []) {
    totals.set(point.timestamp, (totals.get(point.timestamp) ?? 0) + point.value);
  }
  return [...totals.entries()]
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((x, y) => (x.timestamp < y.timestamp ? -1 : 1));
}

// ─── The range-scoped row percentage ─────────────────────────

/**
 * Percentage change in a row's value across the selected range.
 *
 * Returns `null` — rendered as a dash — in every case where there is no
 * honest denominator:
 *
 * - the row has no current value (its price hasn't been fetched yet);
 * - the row's series has no sample at or before the range start. The
 *   backend's first sample boundary *is* the range start, and a row's
 *   series only begins at that position's first activity — so nothing at
 *   or before the start means the position was opened inside the range.
 *   There is nothing to compare against, and a `0.00%` would read as
 *   "unchanged";
 * - the opening value is zero, which no percentage can be taken against.
 *
 * The opening is looked up by timestamp rather than taken as `points[0]`,
 * so it stays correct if a caller ever hands over a series wider than the
 * range it is asking about.
 */
export function rowChangePercent(
  currentValue: number | null,
  points: readonly RangePoint[] | undefined,
  rangeStart: string,
): number | null {
  if (currentValue === null || !Number.isFinite(currentValue)) return null;
  const atOrBefore = (points ?? []).filter((p) => p.timestamp <= rangeStart);
  const opening = atOrBefore[atOrBefore.length - 1];
  if (!opening) return null;
  if (!Number.isFinite(opening.value) || opening.value === 0) return null;
  return ((currentValue - opening.value) / Math.abs(opening.value)) * 100;
}

// ─── Pivots ───────────────────────────────────────────────────

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a + b;
}

/**
 * One row per Instrument, summed across accounts.
 *
 * The CASH instrument is excluded: it is a separate concept the Accounts
 * list and Grid total surface on their own, and `equity` deliberately
 * excludes it so the two can be added without double-counting
 * (docs/adr/0001-dashboard-v2.md § 3). Filtering on `asset_class` rather
 * than on the well-known `cash` id keeps this a domain rule.
 *
 * Sorted by market value, largest first; rows whose price hasn't arrived
 * sort last rather than as zero.
 */
export function buildHoldingRows(args: {
  positions: readonly PositionRow[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
  pointsByInstrument: Record<string, RangePoint[]>;
  rangeStart: string;
}): HoldingRow[] {
  const { positions, instruments, pointsByInstrument, rangeStart } = args;
  const catalog = new Map((instruments ?? []).map((i) => [i.id, i]));

  const merged = new Map<
    string,
    { shareCount: number; marketValue: number | null; realizedGain: number }
  >();
  for (const row of positions ?? []) {
    const instrument = catalog.get(row.instrument_id);
    if (instrument?.asset_class === CASH_ASSET_CLASS) continue;
    const acc = merged.get(row.instrument_id) ?? {
      shareCount: 0,
      marketValue: 0 as number | null,
      realizedGain: 0,
    };
    acc.shareCount += Number(row.share_count);
    acc.marketValue = addNullable(
      acc.marketValue,
      row.market_value === null ? null : Number(row.market_value),
    );
    acc.realizedGain += Number(row.realized_gain);
    merged.set(row.instrument_id, acc);
  }

  return [...merged.entries()]
    .map(([instrumentId, acc]) => ({
      instrumentId,
      symbol: catalog.get(instrumentId)?.symbol ?? instrumentId.toUpperCase(),
      name: catalog.get(instrumentId)?.name ?? instrumentId,
      shareCount: acc.shareCount,
      marketValue: acc.marketValue,
      realizedGain: acc.realizedGain,
      changePercent: rowChangePercent(
        acc.marketValue,
        pointsByInstrument[instrumentId],
        rangeStart,
      ),
    }))
    .sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
}

/**
 * One row per Account, valued including cash.
 *
 * Every account the user owns gets a row, even one with no transactions
 * yet — an account you just created and haven't funded still exists, and
 * silently omitting it would look like a bug.
 */
export function buildAccountRows(args: {
  positions: readonly PositionRow[] | undefined;
  accounts: readonly AccountSummary[] | undefined;
  pointsByAccount: Record<string, RangePoint[]>;
  rangeStart: string;
}): AccountRow[] {
  const { positions, accounts, pointsByAccount, rangeStart } = args;

  const totals = new Map<string, number | null>();
  for (const row of positions ?? []) {
    // `has` rather than `??`, so an already-null total (one unpriced
    // holding) stays null instead of resetting to zero.
    const running = totals.has(row.account_id)
      ? (totals.get(row.account_id) ?? null)
      : 0;
    totals.set(
      row.account_id,
      addNullable(
        running,
        row.market_value === null ? null : Number(row.market_value),
      ),
    );
  }

  return (accounts ?? [])
    .map((account) => {
      const value = totals.has(account.id) ? (totals.get(account.id) ?? null) : 0;
      return {
        accountId: account.id,
        name: account.name,
        accountType: accountTypeLabel(account.account_type),
        value,
        changePercent: rowChangePercent(
          value,
          pointsByAccount[account.id],
          rangeStart,
        ),
      };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

/**
 * Live rows versus fully closed ones.
 *
 * A closed position — zero shares, but realized gain booked — is not a
 * holding any more, and mixing it into the live list makes every total
 * look wrong. It gets its own collapsed disclosure instead.
 */
export function splitClosed<T extends { shareCount: number }>(
  rows: readonly T[],
): { live: T[]; closed: T[] } {
  return {
    live: rows.filter((r) => r.shareCount !== 0),
    closed: rows.filter((r) => r.shareCount === 0),
  };
}

/** Account type as the design writes it, not as the enum spells it. */
export function accountTypeLabel(accountType: string): string {
  switch (accountType) {
    case "brokerage":
      return "Taxable brokerage";
    case "ira":
      return "Retirement";
    case "crypto_exchange":
      return "Crypto exchange";
    case "cash":
      return "Cash only";
    default:
      return accountType;
  }
}
