/**
 * Account-shaped rules that are not view code: the id derivation, and the
 * Accounts sheet's rows.
 *
 * Zero React imports by design (see CLAUDE.md).
 */

import type {
  AccountSummary,
  InstrumentSummary,
  PositionRow,
} from "./positions";
import { accountTypeLabel } from "./positions";

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
  ];
}
