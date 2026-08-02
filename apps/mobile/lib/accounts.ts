/**
 * Account-shaped rules that are not view code: the id derivation, the
 * Accounts sheet's rows, the creation form's validation, and what a
 * cascade delete is about to destroy.
 *
 * Zero React imports by design (see CLAUDE.md). The last two are here for
 * the reason the suppression rule is in `lib/activity.ts`: a destruction
 * summary that quietly counts the wrong thing still renders as a perfectly
 * plausible sentence, and the only way to prove it right is to feed it a
 * ledger and count what comes out.
 */

import type { components } from "./api-types";
import {
  cashInstrumentIds,
  visibleEntries,
  type LedgerEntry,
} from "./activity";
import { formatUsd } from "./format";
import type {
  AccountRow,
  AccountSummary,
  InstrumentSummary,
  PositionRow,
} from "./positions";
import { accountTypeLabel } from "./positions";

export type AccountType = components["schemas"]["AccountType"];
type CreateAccountRequest = components["schemas"]["CreateAccountRequest"];

/**
 * The `account_type` enum, as values rather than as a type.
 *
 * Spelled out through a `Record<AccountType, true>` rather than as a bare
 * array so that adding a member to the backend enum is a **compile error
 * here** instead of a picker silently missing an option. The enum is the
 * backend's and is fixed; this file must not become a second definition of
 * it.
 */
const ACCOUNT_TYPE_MEMBERS: Record<AccountType, true> = {
  brokerage: true,
  ira: true,
  crypto_exchange: true,
  cash: true,
};

export const ACCOUNT_TYPES = Object.keys(
  ACCOUNT_TYPE_MEMBERS,
) as AccountType[];

/** An Account's id is derived from its name (a slug) — a domain rule, not
 * view logic, so it lives here rather than inline in a page. */
export function accountIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** The Accounts sheet's "no account filter" row. Not an account id, so it
 * cannot collide with one. */
export const WHOLE_PORTFOLIO_KEY = "__all__";

/** The Accounts sheet's "add one" row. Same reasoning as the key above —
 * an underscore-wrapped sentinel `accountIdFromName` can never produce. */
export const NEW_ACCOUNT_KEY = "__new__";

export interface AccountOption {
  /** An account id, or `WHOLE_PORTFOLIO_KEY`. */
  key: string;
  label: string;
  /** The row's subtitle — and, when disabled, the reason, shown inline
   * exactly as the Metric and Granularity sheets already do it. */
  note: string;
  selected: boolean;
  disabled: boolean;
}

/**
 * One row per account, plus the whole-portfolio row on top.
 *
 * **What "invalid" means here.** With an instrument selected, picking an
 * account builds a *slice* — that instrument in that account. An account
 * that has never held the instrument has no slice to show: no holding
 * row, no closed row, and a chart the query interface answers with no
 * points at all. Offering it is offering a blank screen, so it is
 * disabled with the reason inline (docs/adr/0001-dashboard-v2.md § 6 is
 * the same shape: states you cannot usefully reach are shown and
 * explained, not hidden).
 *
 * *Has held* rather than *currently holds*: the positions endpoint omits
 * pairs with no history, so its silence is the test. A fully closed
 * position stays selectable — its realized gain and its closed row are
 * real things the slice has to say, and the account chip is how you get
 * to them.
 *
 * With no instrument selected nothing is disabled. Every account is a
 * legitimate destination then, including an empty one: that is what the
 * `equity → cash_balance` auto-adjustment and the empty state are for.
 *
 * The last row creates one. It sits at the bottom rather than the top
 * because this sheet's job is picking a scope and the existing accounts
 * are the answer to that; creating is the escape hatch when none of them
 * is. #24 AC 2 requires it to be reachable here *and* from the Grid tab's
 * Accounts list, so account creation is permanently available rather than
 * an onboarding-only step.
 */
export function buildAccountOptions(args: {
  accounts: readonly AccountSummary[] | undefined;
  positions: readonly PositionRow[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
  selectedAccountId: string | null;
  selectedInstrumentId: string | null;
}): AccountOption[] {
  const {
    accounts,
    positions,
    instruments,
    selectedAccountId,
    selectedInstrumentId,
  } = args;

  // null = no instrument in scope, so nothing to be missing from.
  const holders =
    selectedInstrumentId === null
      ? null
      : new Set(
          (positions ?? [])
            .filter((row) => row.instrument_id === selectedInstrumentId)
            .map((row) => row.account_id),
        );
  const symbol =
    (instruments ?? []).find((i) => i.id === selectedInstrumentId)?.symbol ??
    selectedInstrumentId?.toUpperCase() ??
    "";

  return [
    {
      key: WHOLE_PORTFOLIO_KEY,
      label: "Whole portfolio",
      note: `All ${(accounts ?? []).length} accounts combined`,
      selected: selectedAccountId === null,
      disabled: false,
    },
    ...(accounts ?? []).map((account) => {
      const holdsIt = holders === null || holders.has(account.id);
      return {
        key: account.id,
        label: account.name,
        note: holdsIt
          ? `${account.institution} · ${accountTypeLabel(account.account_type)}`
          : `Never held ${symbol}`,
        selected: selectedAccountId === account.id,
        disabled: !holdsIt,
      };
    }),
    {
      key: NEW_ACCOUNT_KEY,
      label: "Add an account",
      note: "Name it, say where it is held, and pick a type.",
      selected: false,
      disabled: false,
    },
  ];
}

// ─── Creating one ─────────────────────────────────────────────

/** The creation form, as text. Same treatment as `EntryDraft`: what was
 * typed is kept verbatim and `validateAccountDraft` is the one place it
 * becomes a request. */
export interface AccountDraft {
  name: string;
  institution: string;
  accountType: AccountType;
}

export const INITIAL_ACCOUNT_DRAFT: AccountDraft = {
  name: "",
  institution: "",
  // Brokerage rather than nothing: a required radio with no default makes
  // the common case a mandatory extra tap, and this is the common case.
  accountType: "brokerage",
};

export type AccountValidation =
  | { ok: true; request: CreateAccountRequest }
  | { ok: false; reason: string };

/**
 * Is this draft writable, and as what?
 *
 * **The id gets a random suffix, and that is load-bearing.** `accounts.id`
 * is a global `text primary key` and creation is rejected on a collision
 * *even across users* (`AccountService.create_account`) — so a bare slug
 * would let "Fidelity" fail with `Account with id 'fidelity' already
 * exists`, which both blocks a legitimate name and tells the user that
 * some stranger owns one. docs/security.md's rule is that resource
 * existence is not leaked across users; making the id practically unique
 * is how this form stays on the right side of it without redesigning the
 * primary key.
 *
 * Nothing here checks the name against the user's own accounts: two
 * accounts at one institution is exactly why `name` and `institution` are
 * separate fields, and a second "Fidelity" is a thing people really have.
 */
export function validateAccountDraft(
  draft: AccountDraft,
  /** Six-ish random characters, supplied by the caller so this stays
   * pure. */
  suffix: string,
): AccountValidation {
  const name = draft.name.trim();
  const institution = draft.institution.trim();
  if (name === "") return { ok: false, reason: "Give the account a name." };
  if (institution === "") {
    return { ok: false, reason: "Say where it is held." };
  }

  const slug = accountIdFromName(name);
  if (slug === "") {
    return { ok: false, reason: "Use at least one letter or number in the name." };
  }

  return {
    ok: true,
    request: {
      id: `${slug}-${suffix}`,
      name,
      institution,
      account_type: draft.accountType,
    },
  };
}

// ─── Deleting one ─────────────────────────────────────────────

/**
 * The "which one?" step in front of the delete confirmation.
 *
 * Deliberately a separate step rather than a control on each account row:
 * a destructive action sitting inside a list whose rows navigate is one
 * mis-aimed thumb away from being pressed, and #24 asks for deletion that
 * "cannot be triggered by a single accidental tap". Reaching the
 * confirmation at all takes two taps; getting past it takes typing.
 *
 * Each row carries the value that is at stake, so the choice is made with
 * the same number the confirmation will then restate.
 */
export function buildAccountRemovalOptions(
  rows: readonly AccountRow[],
): AccountOption[] {
  return rows.map((row) => ({
    key: row.accountId,
    label: row.name,
    note: `${row.accountType} · ${
      row.value === null ? "—" : formatUsd(row.value)
    }`,
    selected: false,
    disabled: false,
  }));
}

export interface AccountDeletionSummary {
  /** Transactions as the rest of the app counts them — the paired CASH
   * legs are excluded, because "20 transactions" on the Activity header
   * already means the same thing (`lib/activity.ts`). A confirmation that
   * said 40 while the feed says 20 would be describing a different
   * portfolio than the one on screen. */
  transactionCount: number;
  /** The legs that go with them. Counted separately so the copy can
   * promise they are destroyed too — which is the half of the cascade a
   * user cannot see and would otherwise have to take on faith
   * (docs/adr/0001-dashboard-v2.md § 1). */
  cashLegCount: number;
  /** Everything held in the account at today's prices, cash included —
   * the figure its own row in the Accounts list shows. `null` when some
   * holding has no price yet, which that row renders as a dash: a
   * confirmation must not invent a total it cannot stand behind. */
  value: number | null;
}

/**
 * What deleting this account would destroy, in the numbers the ticket
 * asks the confirmation to state.
 *
 * Both come from data the screen already holds — the ledger scoped to the
 * account and the batched positions rows — rather than from a "preview"
 * endpoint. Same instinct as ADR-0001 § 5: the client pivots what it has.
 */
export function buildDeletionSummary(args: {
  accountId: string;
  entries: readonly LedgerEntry[] | undefined;
  positions: readonly PositionRow[] | undefined;
  instruments: readonly InstrumentSummary[] | undefined;
}): AccountDeletionSummary {
  const { accountId, entries, positions, instruments } = args;
  // `cashInstrumentIds` rather than a second "is this cash" rule — the
  // client already has exactly one and it lives beside the suppression
  // predicate that consumes it.
  const cashIds = cashInstrumentIds(instruments);

  const own = (entries ?? []).filter((entry) => entry.account_id === accountId);
  const visible = visibleEntries(own, cashIds);

  let value: number | null = 0;
  for (const row of positions ?? []) {
    if (row.account_id !== accountId) continue;
    if (row.market_value === null) value = null;
    else if (value !== null) value += Number(row.market_value);
  }

  return {
    transactionCount: visible.length,
    cashLegCount: own.length - visible.length,
    value,
  };
}

/** The confirmation's headline: what goes, in concrete terms. */
export function describeAccountDeletion(
  summary: AccountDeletionSummary,
): string {
  const { transactionCount, cashLegCount, value } = summary;
  const transactions =
    transactionCount === 1 ? "1 transaction" : `${transactionCount} transactions`;
  const legs =
    cashLegCount === 0
      ? ""
      : cashLegCount === 1
        ? " (plus the 1 paired cash leg they posted)"
        : ` (plus the ${cashLegCount} paired cash legs they posted)`;
  const worth =
    value === null
      ? "everything computed from them"
      : `${formatUsd(value)} of tracked positions`;

  return `Deleting this removes ${transactions}${legs} and ${worth}. It cannot be undone.`;
}

/**
 * Does what was typed match the account's name?
 *
 * A typed confirmation rather than a second tap, per #30's user story 27:
 * "delete an account behind a **typed confirmation** stating what will be
 * destroyed". Typing the name is the one gesture that cannot be produced
 * by a mis-aimed thumb.
 *
 * Trimmed and case-insensitive: the test is *deliberateness*, not
 * transcription accuracy, and a confirmation you can fail by holding shift
 * teaches people to copy-paste, which is not deliberate at all.
 */
export function confirmationMatches(typed: string, accountName: string): boolean {
  return typed.trim().toLowerCase() === accountName.trim().toLowerCase();
}
