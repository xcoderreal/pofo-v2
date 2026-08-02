/**
 * The Activity tab's derivations: which ledger rows are shown at all, what
 * each one is called, and how they group into months.
 *
 * Zero React imports by design (see CLAUDE.md). The suppression rule in
 * particular belongs here rather than in a component: it is the one piece
 * of this screen that can be *silently* wrong — a feed that quietly
 * doubles, or a Deposit that quietly disappears, both still render as a
 * perfectly plausible list — and the only way to prove it right is to feed
 * it the collision case and count what comes out
 * (docs/design/dashboard_v2/behaviour.md § Activity;
 * docs/adr/0001-dashboard-v2.md § 2).
 */

import type { components } from "./api-types";
import { formatShares, formatUsd } from "./format";

export type LedgerEntry = components["schemas"]["LedgerEntryResponse"];
type InstrumentSummary = components["schemas"]["InstrumentResponse"];
type AccountSummary = components["schemas"]["AccountResponse"];

/**
 * The four badges behaviour.md § Activity names.
 *
 * `deposit` and `withdrawal` read as their own concept even though the
 * ledger stores them as a BUY and a SELL of the CASH instrument
 * (docs/domain-model.md) — "SELL 4,000 USD @ $1.00" is a true description
 * of a withdrawal and a useless one.
 */
export type ActivityKind = "buy" | "sell" | "deposit" | "withdrawal";

const CASH_ASSET_CLASS = "cash";

/**
 * The ids in the catalog that mean cash — in practice exactly one.
 *
 * Derived from `asset_class` rather than hardcoding the server's `"cash"`
 * id, which is the same rule the Holdings list already uses to keep the
 * cash row out of it (`lib/positions.ts`). Two different definitions of
 * "is this cash" in one client is one too many.
 */
export function cashInstrumentIds(
  instruments: readonly InstrumentSummary[] | undefined,
): Set<string> {
  return new Set(
    (instruments ?? [])
      .filter((instrument) => instrument.asset_class === CASH_ASSET_CLASS)
      .map((instrument) => instrument.id),
  );
}

/**
 * **The suppression predicate.** True for a CASH row that is the automatic
 * counter-entry of a trade, and so must not appear in the feed.
 *
 * Every trade auto-posts a paired CASH leg (ADR-0001 § 1). Showing them
 * would roughly double the feed and put a phantom cash movement beside
 * every buy and sell. A CASH row *without* a `trade_id` is the opposite
 * thing — a genuine Deposit or Withdrawal — and renders with its own
 * badge.
 *
 * `trade_id` is a **stored field** carried by both legs of a trade
 * (ADR-0001 § 2), and this reads it directly. It must never be re-derived
 * by matching account, timestamp and amount: two CASH rows in one account,
 * at one instant, for one amount, one of them a trade's proceeds and one
 * of them a real deposit, is not a contrived case — it is what a recurring
 * buy and a payday deposit look like. See the collision test in
 * `tests/unit/lib/activity.test.ts`.
 */
export function isTradeCashLeg(
  entry: LedgerEntry,
  cashIds: ReadonlySet<string>,
): boolean {
  return cashIds.has(entry.instrument_id) && entry.trade_id !== null;
}

/** The feed, with every trade's paired CASH leg removed. */
export function visibleEntries(
  entries: readonly LedgerEntry[] | undefined,
  cashIds: ReadonlySet<string>,
): LedgerEntry[] {
  return (entries ?? []).filter((entry) => !isTradeCashLeg(entry, cashIds));
}

/**
 * Which badge a *visible* row wears.
 *
 * Only reached for rows `visibleEntries` kept, so a CASH row here is
 * always unpaired and therefore always a genuine Deposit or Withdrawal.
 */
export function classifyEntry(
  entry: LedgerEntry,
  cashIds: ReadonlySet<string>,
): ActivityKind {
  if (cashIds.has(entry.instrument_id)) {
    return entry.type === "buy" ? "deposit" : "withdrawal";
  }
  return entry.type === "buy" ? "buy" : "sell";
}

/** What the row moved, signed the way the account's cash moved: a buy and
 * a withdrawal take money out, a sell and a deposit put it in. This is
 * true of a trade precisely *because* of its hidden cash leg. */
export function cashDelta(entry: LedgerEntry, kind: ActivityKind): number {
  const amount = Number(entry.quantity) * Number(entry.price);
  return kind === "buy" || kind === "withdrawal" ? -amount : amount;
}

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  /** `BUY` / `SELL` / `DEP` / `WDL`. */
  badge: string;
  /** `GOOG · 25 @ $186.00`, or `Cash deposit`. */
  description: string;
  /** `Wells Fargo Brokerage · Jun 3, 2026`. */
  subtitle: string;
  /** Signed cash movement, e.g. `−$4,650`. */
  amount: string;
  /** Negative amounts colour differently, and the sign alone is a fragile
   * thing to re-parse out of a formatted string. */
  isOutflow: boolean;
  /** Only ever set on a `sell` — a withdrawal books a definitional zero
   * (CASH always prices at 1), and printing "+$0.00 realized" beside every
   * withdrawal is noise, not information. */
  realizedGain: number | null;
}

export interface ActivityMonth {
  /** `2026-06` — stable across locales, unlike the label. */
  key: string;
  /** `June 2026`. */
  label: string;
  /** Net cash movement across the month's visible rows. */
  net: number;
  rows: ActivityRow[];
}

const BADGES: Record<ActivityKind, string> = {
  buy: "BUY",
  sell: "SELL",
  deposit: "DEP",
  withdrawal: "WDL",
};

/**
 * The whole feed: suppression, classification, month grouping and each
 * month's net, in one pass.
 *
 * Newest first, and the sort is done here rather than trusted from the
 * response — the endpoint does order its rows, but a grouping function
 * whose output depends on its input's order is a trap for the next caller.
 *
 * A month's net is summed over the rows that are *shown*. That is not an
 * approximation of the real cash movement, it is exactly it: a buy's
 * hidden CASH leg is the same dollars as the buy, so counting both would
 * double every trade.
 */
export function buildActivity(args: {
  entries: readonly LedgerEntry[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
  accounts: readonly AccountSummary[] | undefined;
}): ActivityMonth[] {
  const { entries, instruments, accounts } = args;
  const cashIds = cashInstrumentIds(instruments);
  const symbols = new Map(
    (instruments ?? []).map((instrument) => [instrument.id, instrument.symbol]),
  );
  const accountNames = new Map(
    (accounts ?? []).map((account) => [account.id, account.name]),
  );

  const visible = visibleEntries(entries, cashIds).sort((a, b) =>
    a.timestamp === b.timestamp
      ? b.id.localeCompare(a.id)
      : a.timestamp < b.timestamp
        ? 1
        : -1,
  );

  const months: ActivityMonth[] = [];
  for (const entry of visible) {
    const kind = classifyEntry(entry, cashIds);
    const when = parseTimestamp(entry.timestamp);
    const key = monthKey(when);

    let month = months.length > 0 ? months[months.length - 1] : undefined;
    if (month === undefined || month.key !== key) {
      month = { key, label: monthLabel(when), net: 0, rows: [] };
      months.push(month);
    }

    const delta = cashDelta(entry, kind);
    month.net += delta;
    month.rows.push({
      id: entry.id,
      kind,
      badge: BADGES[kind],
      description: describe(entry, kind, symbols),
      subtitle: `${
        accountNames.get(entry.account_id) ?? entry.account_id
      } · ${dayLabel(when)}`,
      amount: `${delta < 0 ? "−" : "+"}${formatUsd(Math.abs(delta))}`,
      isOutflow: delta < 0,
      realizedGain:
        kind === "sell" && entry.realized_gain !== null
          ? Number(entry.realized_gain)
          : null,
    });
  }
  return months;
}

/** What the header says to the right of "Activity" — and, when a scope is
 * applied, that this is a filtered view rather than the whole ledger. */
export function activityScopeLabel(count: number, filtered: boolean): string {
  if (filtered) return `${count} matching`;
  return count === 1 ? "1 transaction" : `${count} transactions`;
}

function describe(
  entry: LedgerEntry,
  kind: ActivityKind,
  symbols: ReadonlyMap<string, string>,
): string {
  if (kind === "deposit") return "Cash deposit";
  if (kind === "withdrawal") return "Cash withdrawal";
  const symbol = symbols.get(entry.instrument_id) ?? entry.instrument_id.toUpperCase();
  return `${symbol} · ${formatShares(Number(entry.quantity))} @ ${formatUsd(
    Number(entry.price),
  )}`;
}

/**
 * The ledger's timestamps are naive (no offset), matching the server's own
 * convention. An ISO datetime *without* an offset is parsed as local time
 * by `Date`, which is what makes the month a row lands in agree with the
 * date printed on it.
 */
function parseTimestamp(text: string): Date {
  return new Date(text);
}

function monthKey(when: Date): string {
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(when: Date): string {
  return when.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function dayLabel(when: Date): string {
  return when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
