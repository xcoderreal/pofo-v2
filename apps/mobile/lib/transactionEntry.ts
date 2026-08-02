/**
 * The transaction entry sheet's derivations: which fields a type shows,
 * what prefills from the view it was opened from, whether a quantity can
 * be sold, and how a rejected write becomes a sentence a user can act on.
 *
 * Zero React imports by design (see CLAUDE.md). Everything the sheet
 * *decides* lives here so it is covered by `bun test` rather than by
 * clicking through a rendered screen — and the piece that matters most is
 * the last one. A trade auto-posts a CASH leg and an overdraw on that leg
 * is rejected (docs/adr/0001-dashboard-v2.md § 1 and § 4), which makes
 * manual back-entry order-dependent: funding Deposits must be recorded
 * before the trades they pay for. A user entering history backwards hits
 * that routinely, so "insufficient cash" has to arrive as an instruction,
 * not as a raw error.
 */

import type { components } from "./api-types";
import type { Scope } from "./drilldown";
import { formatShares, formatUsd } from "./format";
import type { PositionRow, SeriesResponse } from "./positions";
import { isCalendarDate } from "./timeseries";

type CreateTransactionRequest =
  components["schemas"]["CreateTransactionRequest"];
type DepositRequest = components["schemas"]["DepositRequest"];

/** The 409 body's `detail` when a write was rejected for want of shares or
 * of cash. Generated from the backend model, so the two `code` values
 * cannot drift apart from what the API actually sends. */
export type InsufficientFundsDetail =
  components["schemas"]["InsufficientFundsDetail"];

/**
 * The four things a user can record.
 *
 * `deposit`/`withdrawal` are *entry* labels, not a second Transaction
 * shape — each is a BUY/SELL of the CASH instrument underneath
 * (docs/domain-model.md). They get their own types here for the reason the
 * backend gives them their own routes: asking someone to pick an
 * instrument called "USD" is not the mental model.
 */
export type EntryKind = "buy" | "sell" | "deposit" | "withdrawal";

export const ENTRY_KINDS: readonly EntryKind[] = [
  "buy",
  "sell",
  "deposit",
  "withdrawal",
];

export type EntryField =
  | "account"
  | "instrument"
  | "quantity"
  | "price"
  | "amount"
  | "date";

const TRADE_FIELDS: readonly EntryField[] = [
  "account",
  "instrument",
  "quantity",
  "price",
  "date",
];
const CASH_FIELDS: readonly EntryField[] = ["account", "amount", "date"];

export function isCashKind(kind: EntryKind): boolean {
  return kind === "deposit" || kind === "withdrawal";
}

/** Which rows this type shows. A cash movement has no instrument picker
 * and no per-unit price — it has an amount. */
export function entryFields(kind: EntryKind): readonly EntryField[] {
  return isCashKind(kind) ? CASH_FIELDS : TRADE_FIELDS;
}

export function entryKindLabel(kind: EntryKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The form, as text.
 *
 * Numbers are kept as the raw strings the user typed rather than parsed on
 * every keystroke: "1." and "" are both un-numbers, and a draft that
 * silently rewrites what is in the field is unusable on a real keyboard.
 * `validateEntry` is the single place they become numbers.
 */
export interface EntryDraft {
  kind: EntryKind;
  accountId: string | null;
  instrumentId: string | null;
  quantity: string;
  price: string;
  amount: string;
  /** `YYYY-MM-DD` — the same typed-not-picked treatment `DateRangeSheet`
   * uses, and the same reason: a calendar widget is a native dependency
   * this app doesn't have and would have to render in a browser too. */
  date: string;
}

/**
 * A fresh draft for the view the sheet was opened from.
 *
 * The default type follows the prototype's `openTxn`: an account that
 * holds no instruments is one you are about to fund, so it opens on
 * Deposit; everything else opens on Buy. Only with no instrument in scope
 * — an instrument chip is a statement that this is about that holding, and
 * a Deposit cannot be.
 */
export function initialDraft(args: {
  scope: Scope;
  /** `YYYY-MM-DD`; the caller owns "today" so this stays pure. */
  today: string;
  accountHoldsInstruments: boolean;
}): EntryDraft {
  const { scope, today, accountHoldsInstruments } = args;
  const opensOnDeposit =
    scope.accountId !== null &&
    scope.instrumentId === null &&
    !accountHoldsInstruments;

  return {
    kind: opensOnDeposit ? "deposit" : "buy",
    accountId: scope.accountId,
    instrumentId: scope.instrumentId,
    quantity: "",
    price: "",
    amount: "",
    date: today,
  };
}

/**
 * Is this field still showing what the view supplied?
 *
 * The tag is on the *value*, not on the field: prefilled rows stay
 * editable, and a row the user has since changed is no longer "from view"
 * even though it was a moment ago. Comparing against the scope rather than
 * remembering a flag is what makes that fall out for free.
 */
export function isFromContext(
  field: EntryField,
  draft: EntryDraft,
  scope: Scope,
): boolean {
  if (field === "account") {
    return scope.accountId !== null && draft.accountId === scope.accountId;
  }
  if (field === "instrument") {
    return (
      scope.instrumentId !== null && draft.instrumentId === scope.instrumentId
    );
  }
  return false;
}

// ─── Copy ─────────────────────────────────────────────────────

export const ENTRY_SHEET_SUBTITLE = "Manual entry — the only way data gets in.";

/** The sheet's own title, which is where the scope is stated in words
 * before any field is read. */
export function entrySheetTitle(args: {
  symbol: string | null;
  accountName: string | null;
}): string {
  const { symbol, accountName } = args;
  if (symbol !== null && accountName !== null) {
    return `Add ${symbol} in ${accountName}`;
  }
  if (accountName !== null) return `Add to ${accountName}`;
  if (symbol !== null) return `Add ${symbol} transaction`;
  return "Add transaction";
}

/**
 * The line explaining where the prefilled values came from — or, opened
 * from the whole-portfolio view, that there weren't any.
 *
 * The empty case is not an oversight to hide: a sheet with two "Choose…"
 * rows and nothing said about it reads as broken rather than as unscoped.
 */
export function contextNote(scope: Scope): string {
  if (scope.accountId === null && scope.instrumentId === null) {
    return "Nothing was prefilled — you opened this from the whole-portfolio view. Pick an account below, or drill into one first and it comes in filled.";
  }
  return "Prefilled from the view you opened this from — tap either row to change it. The cash side posts to the same account automatically.";
}

/** The submit button. Says what will be written and where, because by the
 * time it is pressed the type segments have scrolled out of thumb reach. */
export function entryCtaLabel(
  draft: EntryDraft,
  labels: { symbol: string | null; accountName: string | null },
): string {
  const subject =
    !isCashKind(draft.kind) && labels.symbol !== null ? ` · ${labels.symbol}` : "";
  const target =
    labels.accountName !== null ? ` → ${labels.accountName}` : "";
  return `Record ${draft.kind}${subject}${target}`;
}

// ─── Held units, and the price prefill ───────────────────────

/**
 * Units of one instrument held in the current scope.
 *
 * Summed across accounts when no account is selected, which is what the
 * Sell hint's "all accounts" wording refers to. Read off the batched
 * positions rows the screen already holds — no extra call
 * (docs/adr/0001-dashboard-v2.md § 5).
 */
export function unitsHeld(args: {
  positions: readonly PositionRow[] | undefined;
  instrumentId: string | null;
  accountId: string | null;
}): number {
  const { positions, instrumentId, accountId } = args;
  if (instrumentId === null) return 0;
  return (positions ?? [])
    .filter(
      (row) =>
        row.instrument_id === instrumentId &&
        (accountId === null || row.account_id === accountId),
    )
    .reduce((total, row) => total + Number(row.share_count), 0);
}

/** The Sell hint: how many units the sell can draw on, and from where. */
export function unitsHeldLabel(
  units: number,
  accountName: string | null,
): string {
  const where = accountName === null ? "across all accounts" : `in ${accountName}`;
  return `${formatShares(units)} held ${where}`;
}

/** The Buy hint. `null` market value — a CASH position the backend has no
 * price for, which cannot happen for cash but is typed as possible — reads
 * as unknown rather than as zero, so the sheet says so instead of
 * asserting the account is empty. */
export function cashAvailableLabel(
  cash: number | null,
  accountName: string | null,
): string {
  const where = accountName === null ? "the account" : accountName;
  if (cash === null) return `Cash available in ${where} is unknown`;
  return `${formatUsd(cash)} cash available in ${where}`;
}

/**
 * The latest point of a `market_price` series, which is what the price
 * field prefills with.
 *
 * A one-instrument `market_price` query rather than `market_value /
 * share_count` off the positions rows: the two agree wherever both exist,
 * but the derived one is only defined for an instrument you already hold —
 * and the first buy of anything is exactly the case where it doesn't.
 *
 * The series is sparse and real-timestamped (docs/domain-model.md
 * § Result shape), so "latest" is the last point, not the point at `end`.
 */
export function latestPriceFromSeries(
  series: readonly SeriesResponse[] | undefined,
): number | null {
  const points = (series ?? []).flatMap((s) => s.points);
  if (points.length === 0) return null;
  const latest = points.reduce((newest, point) =>
    point.timestamp > newest.timestamp ? point : newest,
  );
  const value = Number(latest.value);
  return Number.isFinite(value) ? value : null;
}

// ─── Validation ───────────────────────────────────────────────

/** What `POST` this draft becomes. Deposit and Withdrawal have routes of
 * their own, so the endpoint is part of the decision, not a detail the
 * caller re-derives from `kind`. */
export type EntryRequest =
  | { endpoint: "transaction"; body: CreateTransactionRequest }
  | { endpoint: "deposit"; body: DepositRequest }
  | { endpoint: "withdrawal"; body: DepositRequest };

export type EntryValidation =
  | { ok: true; request: EntryRequest }
  | { ok: false; reason: string };

/** Text to a positive number, or null. Commas are stripped because a user
 * copying a figure off the screen above brings them along. */
function parsePositive(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Is this draft writable, and as what?
 *
 * The one asymmetry here is deliberate. **A sell is stopped locally; a buy
 * is not.** Units held is a fact the sheet is already displaying, so
 * letting a sell past it would be showing the answer and then asking the
 * server the same question. Cash is different: `available` depends on the
 * transaction's own *date*, and the balance the sheet shows is today's —
 * a back-dated buy can be fundable now and unfundable then, or the
 * reverse. Only the ledger replay knows, so the buy goes to the server and
 * `describeEntryError` turns its verdict into an instruction
 * (docs/adr/0001-dashboard-v2.md § 4).
 *
 * The held-units check carries the same caveat in the other direction, so
 * it is a guard against the obvious case rather than the authority: the
 * server re-runs FIFO over the whole ledger regardless.
 */
export function validateEntry(
  draft: EntryDraft,
  context: { unitsHeld: number },
): EntryValidation {
  if (draft.accountId === null) {
    return { ok: false, reason: "Choose the account this belongs to." };
  }
  if (!isCalendarDate(draft.date)) {
    return { ok: false, reason: "Enter the date as YYYY-MM-DD." };
  }
  const timestamp = `${draft.date}T00:00:00`;

  if (isCashKind(draft.kind)) {
    const amount = parsePositive(draft.amount);
    if (amount === null) {
      return { ok: false, reason: "Enter an amount greater than zero." };
    }
    return {
      ok: true,
      request: {
        endpoint: draft.kind === "deposit" ? "deposit" : "withdrawal",
        body: {
          account_id: draft.accountId,
          amount: String(amount),
          timestamp,
        },
      },
    };
  }

  if (draft.instrumentId === null) {
    return { ok: false, reason: "Choose an instrument." };
  }
  const quantity = parsePositive(draft.quantity);
  if (quantity === null) {
    return { ok: false, reason: "Enter how many units, greater than zero." };
  }
  const price = parsePositive(draft.price);
  if (price === null) {
    return { ok: false, reason: "Enter the price per unit, greater than zero." };
  }
  if (draft.kind === "sell" && quantity > context.unitsHeld) {
    return {
      ok: false,
      reason: `Only ${formatShares(
        context.unitsHeld,
      )} units are held in this scope — a sell cannot exceed that.`,
    };
  }

  return {
    ok: true,
    request: {
      endpoint: "transaction",
      body: {
        account_id: draft.accountId,
        instrument_id: draft.instrumentId,
        type: draft.kind === "buy" ? "buy" : "sell",
        quantity: String(quantity),
        price: String(price),
        timestamp,
      },
    },
  };
}

// ─── The server's verdict ─────────────────────────────────────

/**
 * The structured 409 body, if that is what came back.
 *
 * A narrowing rather than a cast: every other error path on this API sends
 * a plain string `detail`, and a sheet that assumed otherwise would render
 * `[object Object]` at the one moment it most needs to be readable.
 */
export function parseInsufficientFunds(
  body: unknown,
): InsufficientFundsDetail | null {
  if (typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return null;
  const candidate = detail as Record<string, unknown>;
  if (
    candidate.code !== "insufficient_cash" &&
    candidate.code !== "insufficient_shares"
  ) {
    return null;
  }
  if (
    typeof candidate.message !== "string" ||
    typeof candidate.account_id !== "string" ||
    typeof candidate.instrument_id !== "string" ||
    typeof candidate.requested !== "string" ||
    typeof candidate.available !== "string"
  ) {
    return null;
  }
  return candidate as unknown as InsufficientFundsDetail;
}

/**
 * A rejected write, as a sentence with an action in it.
 *
 * The insufficient-cash branch is the reason this ticket exists. It names
 * cash as the cause and points at the funding Deposit, because the ledger
 * is order-dependent by design (docs/adr/0001-dashboard-v2.md § 4) and
 * "409" or "Cannot sell 5000 units of 'cash'" tells a user nothing about
 * what to do next.
 *
 * Both figures come from the server rather than from the balance on
 * screen: the server evaluated them *at the transaction's date*, which is
 * the only place the shortfall is true.
 */
export function describeEntryError(args: {
  detail: InsufficientFundsDetail | null;
  /** The error's own message, for anything that isn't an overdraw. */
  fallback: string;
  accountName: string | null;
}): string {
  const { detail, fallback, accountName } = args;
  if (detail === null) return fallback;

  const where = accountName === null ? "this account" : accountName;
  const requested = Number(detail.requested);
  const available = Number(detail.available);

  if (detail.code === "insufficient_cash") {
    return `Not enough cash in ${where} on that date: this needs ${formatUsd(
      requested,
    )} and only ${formatUsd(
      available,
    )} was available. Record the funding Deposit before the transaction it pays for — transactions are entered in date order.`;
  }
  return `Not enough units in ${where} on that date: this sells ${formatShares(
    requested,
  )} and only ${formatShares(available)} were held.`;
}
