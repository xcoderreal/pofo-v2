import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_TYPES,
  accountIdFromName,
  buildAccountOptions,
  buildAccountRemovalOptions,
  buildDeletionSummary,
  confirmationMatches,
  describeAccountDeletion,
  INITIAL_ACCOUNT_DRAFT,
  NEW_ACCOUNT_KEY,
  validateAccountDraft,
  WHOLE_PORTFOLIO_KEY,
  type AccountDraft,
} from "@/lib/accounts";
import type { LedgerEntry } from "@/lib/activity";
import type { AccountRow, PositionRow } from "@/lib/positions";

describe("accountIdFromName", () => {
  test("slugifies a simple name", () => {
    expect(accountIdFromName("Wells Fargo Brokerage")).toBe(
      "wells-fargo-brokerage",
    );
  });

  test("collapses punctuation and trims leading/trailing hyphens", () => {
    expect(accountIdFromName("  Fidelity — IRA! ")).toBe("fidelity-ira");
  });
});

const ACCOUNTS = [
  {
    id: "acc1",
    name: "Wells Fargo Brokerage",
    institution: "Wells Fargo",
    account_type: "brokerage",
  },
  {
    id: "acc2",
    name: "Cash Reserve",
    institution: "Ally",
    account_type: "cash",
  },
] as const;

const INSTRUMENTS = [
  { id: "goog", symbol: "GOOG", name: "Alphabet Inc", asset_class: "equity" },
] as const;

function position(overrides: Partial<PositionRow> = {}): PositionRow {
  return {
    account_id: "acc1",
    instrument_id: "goog",
    share_count: "10",
    cost_basis: "1000",
    average_cost: "100",
    market_value: "1300",
    realized_gain: "0",
    unrealized_gain: "300",
    ...overrides,
  };
}

describe("buildAccountOptions — the Accounts sheet's rows", () => {
  test("the whole-portfolio row comes first and counts the accounts", () => {
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: null,
    });

    expect(options[0].key).toBe(WHOLE_PORTFOLIO_KEY);
    expect(options[0].note).toBe("All 2 accounts combined");
    expect(options[0].selected).toBe(true);
    expect(options[0].disabled).toBe(false);
  });

  test("with no instrument in scope every account is selectable", () => {
    // An account with nothing in it is still a legitimate destination —
    // the equity -> cash_balance auto-adjustment and the empty state are
    // what handle it (behaviour.md § Auto-adjustments).
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: null,
    });

    expect(options.map((o) => o.disabled)).toEqual([false, false, false, false]);
    expect(options[1].note).toBe("Wells Fargo · Taxable brokerage");
  });

  test("with an instrument in scope an account that never held it is disabled", () => {
    // The bug this guards against: AC 18.6 asks for invalid options to be
    // shown with the reason inline, and the Accounts sheet disabled
    // nothing at all — picking Cash Reserve while holding GOOG built a
    // slice with no rows and no chart.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [position({ account_id: "acc1" })],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[1]).toMatchObject({ key: "acc1", disabled: false });
    expect(options[2]).toMatchObject({
      key: "acc2",
      disabled: true,
      note: "Never held GOOG",
    });
  });

  test("a fully closed position keeps its account selectable", () => {
    // Zero shares, but the realized gain and the closed row are real
    // things the slice has to say.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [
        position({ account_id: "acc2", share_count: "0", realized_gain: "340" }),
      ],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[2]).toMatchObject({ key: "acc2", disabled: false });
  });

  test("the selected account is marked, and the whole-portfolio row is not", () => {
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: "acc2",
      selectedInstrumentId: null,
    });

    expect(options.map((o) => o.selected)).toEqual([false, false, true, false]);
  });

  test("falls back to the raw id when the catalog has not loaded", () => {
    // Same reasoning as the chips: a reason naming "GOOG" is better than
    // one naming nothing at all.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: undefined,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[1].note).toBe("Never held GOOG");
  });

  test("no accounts yet is an empty list, not a crash", () => {
    const options = buildAccountOptions({
      accounts: undefined,
      positions: undefined,
      instruments: undefined,
      selectedAccountId: null,
      selectedInstrumentId: null,
    });

    expect(options).toHaveLength(2);
    expect(options[0].note).toBe("All 0 accounts combined");
    expect(options[1].key).toBe(NEW_ACCOUNT_KEY);
  });

  test("the last row creates one, and is never a selection", () => {
    // #24 AC 2: creation is reachable from here permanently, not only
    // during onboarding. Last, because this sheet's job is picking a scope
    // and the existing accounts are the answer to that.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [],
      instruments: INSTRUMENTS,
      selectedAccountId: "acc1",
      selectedInstrumentId: null,
    });

    const last = options[options.length - 1];
    expect(last.key).toBe(NEW_ACCOUNT_KEY);
    expect(last.selected).toBe(false);
    expect(last.disabled).toBe(false);
  });

  test("the create row survives an instrument scope that disables accounts", () => {
    // It is not an account, so "never held GOOG" cannot apply to it — and
    // an instrument chip is a common reason to need a *new* account.
    const options = buildAccountOptions({
      accounts: ACCOUNTS,
      positions: [position({ account_id: "acc1" })],
      instruments: INSTRUMENTS,
      selectedAccountId: null,
      selectedInstrumentId: "goog",
    });

    expect(options[options.length - 1]).toMatchObject({
      key: NEW_ACCOUNT_KEY,
      disabled: false,
    });
  });
});

describe("ACCOUNT_TYPES", () => {
  test("is exactly the backend's fixed enum, in its own order", () => {
    // The values are the backend's `AccountType`; this array only makes
    // them iterable. A member added there is a compile error in
    // `lib/accounts.ts` (the Record is exhaustive), and this pins the
    // runtime list so a picker can never silently drop one.
    expect(ACCOUNT_TYPES).toEqual([
      "brokerage",
      "ira",
      "crypto_exchange",
      "cash",
    ]);
  });
});

describe("validateAccountDraft", () => {
  function draft(overrides: Partial<AccountDraft> = {}): AccountDraft {
    return {
      ...INITIAL_ACCOUNT_DRAFT,
      name: "Wells Fargo Brokerage",
      institution: "Wells Fargo",
      ...overrides,
    };
  }

  test("builds a create request, trimming what was typed", () => {
    const result = validateAccountDraft(
      draft({ name: "  Fidelity IRA ", institution: " Fidelity ", accountType: "ira" }),
      "ab12cd",
    );

    expect(result).toEqual({
      ok: true,
      request: {
        id: "fidelity-ira-ab12cd",
        name: "Fidelity IRA",
        institution: "Fidelity",
        account_type: "ira",
      },
    });
  });

  test("the id carries a random suffix, so a global collision can't reject a name", () => {
    // `accounts.id` is a global primary key and creation is rejected on a
    // collision even across users — a bare slug would let a second user's
    // "Fidelity" both fail and reveal that someone else owns one.
    const a = validateAccountDraft(draft({ name: "Fidelity" }), "aaaaaa");
    const b = validateAccountDraft(draft({ name: "Fidelity" }), "bbbbbb");

    expect(a.ok && a.request.id).toBe("fidelity-aaaaaa");
    expect(b.ok && b.request.id).toBe("fidelity-bbbbbb");
  });

  test("a blank name or institution blocks with a reason, not silently", () => {
    expect(validateAccountDraft(draft({ name: "   " }), "x")).toEqual({
      ok: false,
      reason: "Give the account a name.",
    });
    expect(validateAccountDraft(draft({ institution: "" }), "x")).toEqual({
      ok: false,
      reason: "Say where it is held.",
    });
  });

  test("a name with nothing sluggable in it is refused", () => {
    // The id is derived from the name, and "•••" derives to "" — which
    // would POST an id of "-x".
    const result = validateAccountDraft(draft({ name: "•••" }), "x");

    expect(result).toEqual({
      ok: false,
      reason: "Use at least one letter or number in the name.",
    });
  });

  test("the default draft is not writable, and says which field is missing first", () => {
    expect(validateAccountDraft(INITIAL_ACCOUNT_DRAFT, "x")).toEqual({
      ok: false,
      reason: "Give the account a name.",
    });
  });
});

// ─── The destruction summary ──────────────────────────────────

const CASH = {
  id: "cash",
  symbol: "USD",
  name: "Cash",
  asset_class: "cash",
} as const;

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "t1",
    account_id: "acc1",
    instrument_id: "goog",
    type: "buy",
    quantity: "10",
    price: "100",
    timestamp: "2026-01-02T00:00:00",
    trade_id: null,
    realized_gain: null,
    ...overrides,
  };
}

describe("buildDeletionSummary", () => {
  test("counts transactions the way the rest of the app does, and the legs separately", () => {
    // A buy, its auto-posted CASH leg, and a genuine deposit. The feed
    // shows two of those three (docs/adr/0001-dashboard-v2.md § 2), so a
    // confirmation claiming three would be describing a portfolio the user
    // has never seen.
    const summary = buildDeletionSummary({
      accountId: "acc1",
      entries: [
        entry({ id: "t1", trade_id: "t1" }),
        entry({
          id: "t1-cash",
          instrument_id: "cash",
          type: "sell",
          quantity: "1000",
          price: "1",
          trade_id: "t1",
        }),
        entry({
          id: "d1",
          instrument_id: "cash",
          type: "buy",
          quantity: "5000",
          price: "1",
        }),
      ],
      positions: [],
      instruments: [INSTRUMENTS[0], CASH],
    });

    expect(summary.transactionCount).toBe(2);
    expect(summary.cashLegCount).toBe(1);
  });

  test("values the account including its cash, and ignores other accounts", () => {
    const summary = buildDeletionSummary({
      accountId: "acc1",
      entries: [],
      positions: [
        position({ account_id: "acc1", market_value: "1300" }),
        position({ account_id: "acc1", instrument_id: "cash", market_value: "700" }),
        position({ account_id: "acc2", market_value: "9999" }),
      ],
      instruments: [INSTRUMENTS[0], CASH],
    });

    expect(summary.value).toBe(2000);
  });

  test("an unpriced holding makes the value unknown rather than understated", () => {
    // The Accounts row renders a dash for exactly this; a confirmation
    // must not quietly report the priced part as the total.
    const summary = buildDeletionSummary({
      accountId: "acc1",
      entries: [],
      positions: [
        position({ account_id: "acc1", market_value: "1300" }),
        position({ account_id: "acc1", instrument_id: "tsla", market_value: null }),
      ],
      instruments: [INSTRUMENTS[0], CASH],
    });

    expect(summary.value).toBeNull();
  });

  test("an empty account summarises to nothing at all, not a crash", () => {
    expect(
      buildDeletionSummary({
        accountId: "acc1",
        entries: undefined,
        positions: undefined,
        instruments: undefined,
      }),
    ).toEqual({ transactionCount: 0, cashLegCount: 0, value: 0 });
  });
});

describe("describeAccountDeletion", () => {
  test("states both figures the ticket asks the confirmation to state", () => {
    expect(
      describeAccountDeletion({
        transactionCount: 12,
        cashLegCount: 8,
        value: 48320.19,
      }),
    ).toBe(
      "Deleting this removes 12 transactions (plus the 8 paired cash legs they posted) and $48,320 of tracked positions. It cannot be undone.",
    );
  });

  test("singulars read as English, and no legs means no parenthesis", () => {
    expect(
      describeAccountDeletion({ transactionCount: 1, cashLegCount: 1, value: 0 }),
    ).toBe(
      "Deleting this removes 1 transaction (plus the 1 paired cash leg they posted) and $0.00 of tracked positions. It cannot be undone.",
    );
    expect(
      describeAccountDeletion({ transactionCount: 3, cashLegCount: 0, value: 10 }),
    ).toBe(
      "Deleting this removes 3 transactions and $10.00 of tracked positions. It cannot be undone.",
    );
  });

  test("an unknown value says so instead of naming a figure", () => {
    expect(
      describeAccountDeletion({ transactionCount: 2, cashLegCount: 0, value: null }),
    ).toContain("everything computed from them");
  });
});

describe("confirmationMatches", () => {
  test("accepts the name, trimmed and in any case", () => {
    // The test is deliberateness, not transcription — a confirmation you
    // can fail by holding shift teaches people to copy-paste.
    expect(confirmationMatches("  wells fargo brokerage ", "Wells Fargo Brokerage")).toBe(
      true,
    );
  });

  test("rejects a near miss, and rejects nothing at all", () => {
    expect(confirmationMatches("Wells Fargo", "Wells Fargo Brokerage")).toBe(false);
    expect(confirmationMatches("", "Wells Fargo Brokerage")).toBe(false);
    // An account whose name is blank must not be deletable by an empty box.
    expect(confirmationMatches("", "   ")).toBe(true);
  });
});

describe("buildAccountRemovalOptions", () => {
  function row(overrides: Partial<AccountRow> = {}): AccountRow {
    return {
      accountId: "acc1",
      name: "Wells Fargo Brokerage",
      accountType: "Taxable brokerage",
      value: 12345.6,
      changePercent: 1.2,
      ...overrides,
    };
  }

  test("each row carries the value that is at stake", () => {
    expect(buildAccountRemovalOptions([row()])).toEqual([
      {
        key: "acc1",
        label: "Wells Fargo Brokerage",
        note: "Taxable brokerage · $12,346",
        selected: false,
        disabled: false,
      },
    ]);
  });

  test("an unpriced account shows a dash rather than a fabricated total", () => {
    expect(buildAccountRemovalOptions([row({ value: null })])[0].note).toBe(
      "Taxable brokerage · —",
    );
  });
});
