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
 *    does — `changePercent` is the single rule both go through. A row
 *    with no honest pair of endpoints renders a dash rather than a
 *    fabricated number
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

/** One account's share of a single instrument — the "Across your
 * accounts" list at instrument level, and the single row at slice
 * level. */
export interface InstrumentAccountRow {
  accountId: string;
  name: string;
  accountType: string;
  shareCount: number;
  /** null once the position is closed: a zero cost basis over zero
   * shares has no average, and a $0 would read as a real price paid. */
  averageCost: number | null;
  marketValue: number | null;
  realizedGain: number;
  changePercent: number | null;
}

/** The six figures of the instrument-level stat card, summed across
 * every account in scope. */
export interface InstrumentStats {
  shareCount: number;
  /** Derived as `marketValue / shareCount` rather than fetched: the two
   * come from the same batched positions call the stat card already
   * reads (docs/adr/0001-dashboard-v2.md § 5), and `market_value` is
   * exactly `shares × close`. null once there are no shares to divide
   * by, or before any price has arrived. */
  marketPrice: number | null;
  averageCost: number | null;
  marketValue: number | null;
  unrealizedGain: number | null;
  realizedGain: number;
  costBasis: number;
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

/**
 * "Account value including cash", per account, from the two grouped
 * series that carry it.
 *
 * Two queries rather than one because `equity` deliberately excludes CASH
 * so the two can be added without double-counting
 * (docs/adr/0001-dashboard-v2.md § 3) — which makes recombining them a
 * pivot, and pivots live here beside the others rather than inline in a
 * screen.
 *
 * The union of both key sets, not either one alone: a cash-only account
 * appears in `cash` and not in `equity`, and a fully-invested one the
 * other way round.
 */
export function combineAccountSeries(
  equity: Record<string, RangePoint[]>,
  cash: Record<string, RangePoint[]>,
): Record<string, RangePoint[]> {
  const combined: Record<string, RangePoint[]> = {};
  for (const id of new Set([...Object.keys(equity), ...Object.keys(cash)])) {
    combined[id] = addSeries(equity[id], cash[id]);
  }
  return combined;
}

// ─── The range-scoped percentage ─────────────────────────────

/**
 * The one percentage rule on this screen: change across a window,
 * measured against the magnitude of where it opened.
 *
 * The magnitude matters — `unrealized_gain` opens negative often enough,
 * and a loss shrinking from −100 to −50 is a *rise*, not a −50% fall.
 *
 * `null` where no percentage exists, which the UI renders as a dash: a
 * zero opening has no percentage rather than an infinite one, and a
 * fabricated `0.00%` would read as "unchanged" (behaviour.md
 * § Percentages).
 *
 * Both the headline figure and every list row go through here. They used
 * to carry a copy each, `Math.abs` denominator and all — two copies of
 * the rule this module exists to hold once.
 */
export function changePercent(opening: number, closing: number): number | null {
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) return null;
  if (opening === 0) return null;
  return ((closing - opening) / Math.abs(opening)) * 100;
}

/**
 * Percentage change in a row's value across the selected range.
 *
 * Returns `null` — rendered as a dash — in every case where there is no
 * honest pair of endpoints:
 *
 * - the row has no current value (its price hasn't been fetched yet);
 * - **the range does not end today.** `/portfolio/positions` takes no
 *   date, so `currentValue` is always *today's* — which is the range end
 *   only while the range ends today. On a Custom range ending in the past
 *   the header measures first → last of that window while a row would be
 *   measuring rangeStart → today: two percentages that look identical,
 *   sit inches apart and mean different things. That is precisely the
 *   defect behaviour.md § Percentages was written to kill, so the row
 *   says nothing rather than saying something else;
 * - the row's series has no sample at or before the range start. The
 *   backend's first sample boundary *is* the range start, and a row's
 *   series only begins at that position's first activity — so nothing at
 *   or before the start means the position was opened inside the range.
 *   There is nothing to compare against;
 * - the opening value is zero, which no percentage can be taken against.
 *
 * The opening is looked up by timestamp rather than taken as `points[0]`,
 * so it stays correct if a caller ever hands over a series wider than the
 * range it is asking about.
 */
export function rowChangePercent(args: {
  /** The row's value *now*, from the batched positions endpoint. */
  currentValue: number | null;
  /** The row's own range-scoped series — the denominator's source. */
  points: readonly RangePoint[] | undefined;
  rangeStart: string;
  /** Whether `currentValue` is also the range's *end* value, i.e. whether
   * the selected range runs to today. */
  currentValueIsRangeEnd: boolean;
}): number | null {
  const { currentValue, points, rangeStart, currentValueIsRangeEnd } = args;
  if (!currentValueIsRangeEnd) return null;
  if (currentValue === null || !Number.isFinite(currentValue)) return null;
  const atOrBefore = (points ?? []).filter((p) => p.timestamp <= rangeStart);
  const opening = atOrBefore[atOrBefore.length - 1];
  if (!opening) return null;
  return changePercent(opening.value, currentValue);
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
  /** See `rowChangePercent` — false suppresses the percentage entirely. */
  currentValueIsRangeEnd: boolean;
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
      changePercent: rowChangePercent({
        currentValue: acc.marketValue,
        points: pointsByInstrument[instrumentId],
        rangeStart,
        currentValueIsRangeEnd: args.currentValueIsRangeEnd,
      }),
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
  /** See `rowChangePercent` — false suppresses the percentage entirely. */
  currentValueIsRangeEnd: boolean;
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
        changePercent: rowChangePercent({
          currentValue: value,
          points: pointsByAccount[account.id],
          rangeStart,
          currentValueIsRangeEnd: args.currentValueIsRangeEnd,
        }),
      };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

/**
 * One row per Account holding a given Instrument — the instrument level's
 * "Across your accounts" list, and the single row a slice shows.
 *
 * Accounts that never traded the instrument are absent by construction:
 * the positions endpoint omits pairs with no history, so this list is
 * "accounts that have held it", not the whole account catalog. That is
 * the opposite of `buildAccountRows`, which lists every account the user
 * owns — there, an unfunded account is a real thing you own; here, an
 * account that never touched GOOG is not part of your GOOG position.
 */
export function buildInstrumentAccountRows(args: {
  positions: readonly PositionRow[] | undefined;
  accounts: readonly AccountSummary[] | undefined;
  instrumentId: string;
  pointsByAccount: Record<string, RangePoint[]>;
  rangeStart: string;
  /** See `rowChangePercent` — false suppresses the percentage entirely. */
  currentValueIsRangeEnd: boolean;
}): InstrumentAccountRow[] {
  const { positions, accounts, instrumentId, pointsByAccount, rangeStart } = args;
  const catalog = new Map((accounts ?? []).map((a) => [a.id, a]));

  return (positions ?? [])
    .filter((row) => row.instrument_id === instrumentId)
    .map((row) => {
      const account = catalog.get(row.account_id);
      const marketValue =
        row.market_value === null ? null : Number(row.market_value);
      return {
        accountId: row.account_id,
        name: account?.name ?? row.account_id,
        accountType: accountTypeLabel(account?.account_type ?? ""),
        shareCount: Number(row.share_count),
        averageCost:
          row.average_cost === null ? null : Number(row.average_cost),
        marketValue,
        realizedGain: Number(row.realized_gain),
        changePercent: rowChangePercent({
          currentValue: marketValue,
          points: pointsByAccount[row.account_id],
          rangeStart,
          currentValueIsRangeEnd: args.currentValueIsRangeEnd,
        }),
      };
    })
    .sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
}

/**
 * The instrument stat card: shares, market price, average cost,
 * unrealized gain, all-time realized gain and cost basis, summed over
 * whichever accounts are in scope.
 *
 * Unrealized gain is summed from the rows rather than recomputed as
 * `marketValue − costBasis`, so the "no price yet" rule stays the
 * backend's single decision (GainsService) instead of being re-derived
 * with a different answer here.
 */
export function buildInstrumentStats(
  positions: readonly PositionRow[] | undefined,
  instrumentId: string,
): InstrumentStats {
  let shareCount = 0;
  let costBasis = 0;
  let realizedGain = 0;
  let marketValue: number | null = 0;
  let unrealizedGain: number | null = 0;

  for (const row of positions ?? []) {
    if (row.instrument_id !== instrumentId) continue;
    shareCount += Number(row.share_count);
    costBasis += Number(row.cost_basis);
    realizedGain += Number(row.realized_gain);
    marketValue = addNullable(
      marketValue,
      row.market_value === null ? null : Number(row.market_value),
    );
    unrealizedGain = addNullable(
      unrealizedGain,
      row.unrealized_gain === null ? null : Number(row.unrealized_gain),
    );
  }

  return {
    shareCount,
    marketPrice:
      shareCount === 0 || marketValue === null ? null : marketValue / shareCount,
    averageCost: shareCount === 0 ? null : costBasis / shareCount,
    marketValue,
    unrealizedGain,
    realizedGain,
    costBasis,
  };
}

/**
 * Uninvested cash in one account, or null when the account has no CASH
 * position at all.
 *
 * CASH is priced at exactly 1, so its position's market value *is* the
 * balance — the same derivation path as any other instrument, which is
 * the whole point of storing the cash leg as a Transaction
 * (docs/adr/0001-dashboard-v2.md § 2).
 */
export function cashBalanceFor(args: {
  positions: readonly PositionRow[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
  accountId: string;
}): number | null {
  const { positions, instruments, accountId } = args;
  const catalog = new Map((instruments ?? []).map((i) => [i.id, i]));

  for (const row of positions ?? []) {
    if (row.account_id !== accountId) continue;
    if (catalog.get(row.instrument_id)?.asset_class !== CASH_ASSET_CLASS) continue;
    return row.market_value === null ? null : Number(row.market_value);
  }
  return null;
}

/**
 * Does this account hold any instrument at all?
 *
 * Drives auto-adjustment 1 — an account with nothing but cash switches
 * the metric to `cash_balance`. A fully closed position does not count:
 * zero shares chart as a flat zero under every holdings metric, which is
 * exactly the blank the auto-adjustment exists to avoid.
 */
export function accountHoldsInstruments(args: {
  positions: readonly PositionRow[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
  accountId: string;
}): boolean {
  const { positions, instruments, accountId } = args;
  const catalog = new Map((instruments ?? []).map((i) => [i.id, i]));

  return (positions ?? []).some(
    (row) =>
      row.account_id === accountId &&
      catalog.get(row.instrument_id)?.asset_class !== CASH_ASSET_CLASS &&
      Number(row.share_count) !== 0,
  );
}

/**
 * Live rows versus fully closed ones.
 *
 * A closed position — zero shares, but realized gain booked — is not a
 * holding any more, and mixing it into the live list makes every total
 * look wrong. It gets its own collapsed disclosure instead.
 *
 * "But with realized gain" is load-bearing, not decoration: a round trip
 * at cost leaves zero shares *and* zero booked, and filing that under
 * "Closed positions · 1 … realized +$0.00" advertises a disclosure with
 * nothing inside it. Such a row belongs to neither list and is dropped —
 * the position is over and it made no difference.
 */
export function splitClosed<T extends { shareCount: number; realizedGain: number }>(
  rows: readonly T[],
): { live: T[]; closed: T[] } {
  return {
    live: rows.filter((r) => r.shareCount !== 0),
    closed: rows.filter((r) => r.shareCount === 0 && r.realizedGain !== 0),
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
