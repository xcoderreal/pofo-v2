import { describe, expect, test } from "bun:test";
import type { Scope } from "@/lib/drilldown";
import type { PositionRow, SeriesResponse } from "@/lib/positions";
import {
  cashAvailableLabel,
  contextNote,
  describeEntryError,
  entryCtaLabel,
  entryFields,
  entrySheetTitle,
  initialDraft,
  isCashKind,
  isFromContext,
  latestPriceFromSeries,
  parseInsufficientFunds,
  unitsHeld,
  unitsHeldLabel,
  validateEntry,
  type EntryDraft,
} from "@/lib/transactionEntry";

const WHOLE_PORTFOLIO: Scope = { instrumentId: null, accountId: null };
const SLICE: Scope = { instrumentId: "goog", accountId: "ira" };

function position(overrides: Partial<PositionRow> = {}): PositionRow {
  return {
    account_id: "ira",
    instrument_id: "goog",
    share_count: "10",
    cost_basis: "1000",
    average_cost: "100",
    market_value: "1200",
    realized_gain: "0",
    unrealized_gain: "200",
    ...overrides,
  };
}

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: "buy",
    accountId: "ira",
    instrumentId: "goog",
    quantity: "",
    price: "",
    amount: "",
    date: "2026-08-01",
    ...overrides,
  };
}

describe("entryFields — a cash movement has no instrument and no unit price", () => {
  test("a trade takes account, instrument, units, price and date", () => {
    expect(entryFields("buy")).toEqual([
      "account",
      "instrument",
      "quantity",
      "price",
      "date",
    ]);
    expect(entryFields("sell")).toEqual(entryFields("buy"));
  });

  test("a deposit or withdrawal takes account, amount and date", () => {
    // No instrument picker: asking a user to pick "USD" is not the mental
    // model (docs/domain-model.md).
    expect(entryFields("deposit")).toEqual(["account", "amount", "date"]);
    expect(entryFields("withdrawal")).toEqual(entryFields("deposit"));
    expect(isCashKind("withdrawal")).toBe(true);
    expect(isCashKind("buy")).toBe(false);
  });
});

describe("initialDraft — prefilling from the view it was opened from", () => {
  test("a slice fills both slots", () => {
    const d = initialDraft({
      scope: SLICE,
      today: "2026-08-01",
      accountHoldsInstruments: true,
    });

    expect(d.accountId).toBe("ira");
    expect(d.instrumentId).toBe("goog");
    expect(d.date).toBe("2026-08-01");
  });

  test("the whole-portfolio view fills nothing", () => {
    const d = initialDraft({
      scope: WHOLE_PORTFOLIO,
      today: "2026-08-01",
      accountHoldsInstruments: false,
    });

    expect(d.accountId).toBeNull();
    expect(d.instrumentId).toBeNull();
    expect(d.kind).toBe("buy");
  });

  test("an account holding nothing opens on Deposit", () => {
    const d = initialDraft({
      scope: { instrumentId: null, accountId: "reserve" },
      today: "2026-08-01",
      accountHoldsInstruments: false,
    });

    expect(d.kind).toBe("deposit");
  });

  test("an account that does hold instruments opens on Buy", () => {
    const d = initialDraft({
      scope: { instrumentId: null, accountId: "ira" },
      today: "2026-08-01",
      accountHoldsInstruments: true,
    });

    expect(d.kind).toBe("buy");
  });

  test("an instrument chip keeps it on Buy even in an empty account", () => {
    // A Deposit cannot be "about GOOG", so the instrument slot wins.
    const d = initialDraft({
      scope: { instrumentId: "goog", accountId: "reserve" },
      today: "2026-08-01",
      accountHoldsInstruments: false,
    });

    expect(d.kind).toBe("buy");
  });
});

describe("isFromContext — the tag is on the value, not the field", () => {
  test("an untouched prefilled row is marked", () => {
    expect(isFromContext("account", draft(), SLICE)).toBe(true);
    expect(isFromContext("instrument", draft(), SLICE)).toBe(true);
  });

  test("changing the value drops the mark", () => {
    const edited = draft({ accountId: "brokerage" });

    expect(isFromContext("account", edited, SLICE)).toBe(false);
    expect(isFromContext("instrument", edited, SLICE)).toBe(true);
  });

  test("nothing is from context when nothing was in scope", () => {
    expect(isFromContext("account", draft(), WHOLE_PORTFOLIO)).toBe(false);
    expect(isFromContext("instrument", draft(), WHOLE_PORTFOLIO)).toBe(false);
  });

  test("a typed field is never from context", () => {
    expect(isFromContext("quantity", draft(), SLICE)).toBe(false);
  });
});

describe("copy", () => {
  test("the whole-portfolio note says nothing was prefilled", () => {
    expect(contextNote(WHOLE_PORTFOLIO)).toContain("Nothing was prefilled");
    expect(contextNote(SLICE)).toContain("Prefilled from the view");
  });

  test("the title names whichever half of the scope exists", () => {
    expect(entrySheetTitle({ symbol: "GOOG", accountName: "IRA" })).toBe(
      "Add GOOG in IRA",
    );
    expect(entrySheetTitle({ symbol: null, accountName: "IRA" })).toBe(
      "Add to IRA",
    );
    expect(entrySheetTitle({ symbol: "GOOG", accountName: null })).toBe(
      "Add GOOG transaction",
    );
    expect(entrySheetTitle({ symbol: null, accountName: null })).toBe(
      "Add transaction",
    );
  });

  test("the CTA names the type, the subject and the destination", () => {
    expect(
      entryCtaLabel(draft(), { symbol: "GOOG", accountName: "IRA" }),
    ).toBe("Record buy · GOOG → IRA");
    // A deposit has no instrument to name even when one is in scope.
    expect(
      entryCtaLabel(draft({ kind: "deposit" }), {
        symbol: "GOOG",
        accountName: "IRA",
      }),
    ).toBe("Record deposit → IRA");
  });
});

describe("unitsHeld — what a sell can draw on", () => {
  const positions = [
    position({ account_id: "ira", share_count: "10" }),
    position({ account_id: "brokerage", share_count: "25" }),
    position({ account_id: "ira", instrument_id: "voo", share_count: "90" }),
  ];

  test("scoped to one account when one is selected", () => {
    expect(
      unitsHeld({ positions, instrumentId: "goog", accountId: "ira" }),
    ).toBe(10);
  });

  test("summed across accounts when none is", () => {
    expect(
      unitsHeld({ positions, instrumentId: "goog", accountId: null }),
    ).toBe(35);
  });

  test("no instrument means nothing to sell", () => {
    expect(
      unitsHeld({ positions, instrumentId: null, accountId: "ira" }),
    ).toBe(0);
  });

  test("the hint says how many and from where", () => {
    expect(unitsHeldLabel(10, "Wells Fargo IRA")).toBe(
      "10 held in Wells Fargo IRA",
    );
    expect(unitsHeldLabel(35, null)).toBe("35 held across all accounts");
  });
});

describe("cashAvailableLabel — what a buy has to pay with", () => {
  test("states the balance and the account", () => {
    expect(cashAvailableLabel(4200, "Wells Fargo IRA")).toBe(
      "$4,200.00 cash available in Wells Fargo IRA",
    );
  });

  test("an unknown balance is not reported as zero", () => {
    expect(cashAvailableLabel(null, "Wells Fargo IRA")).toBe(
      "Cash available in Wells Fargo IRA is unknown",
    );
  });
});

describe("latestPriceFromSeries — the price prefill", () => {
  const series: SeriesResponse[] = [
    {
      group: "all",
      points: [
        { timestamp: "2026-07-30", value: "184.20" },
        { timestamp: "2026-07-31", value: "186.00" },
      ],
    },
  ];

  test("takes the newest point, not the last in the array", () => {
    expect(latestPriceFromSeries(series)).toBe(186);
    expect(
      latestPriceFromSeries([
        { group: "all", points: [...series[0].points].reverse() },
      ]),
    ).toBe(186);
  });

  test("an instrument with no price history prefills nothing", () => {
    expect(latestPriceFromSeries([])).toBeNull();
    expect(latestPriceFromSeries([{ group: "all", points: [] }])).toBeNull();
    expect(latestPriceFromSeries(undefined)).toBeNull();
  });
});

describe("validateEntry", () => {
  const held = { unitsHeld: 10 };

  test("a complete buy becomes a POST /transactions body", () => {
    const result = validateEntry(
      draft({ quantity: "5", price: "186.00" }),
      held,
    );

    expect(result).toEqual({
      ok: true,
      request: {
        endpoint: "transaction",
        body: {
          account_id: "ira",
          instrument_id: "goog",
          type: "buy",
          quantity: "5",
          price: "186",
          timestamp: "2026-08-01T00:00:00",
        },
      },
    });
  });

  test("a deposit becomes its own route's body, with no instrument", () => {
    const result = validateEntry(
      draft({ kind: "deposit", amount: "10,000" }),
      held,
    );

    expect(result).toEqual({
      ok: true,
      request: {
        endpoint: "deposit",
        body: {
          account_id: "ira",
          amount: "10000",
          timestamp: "2026-08-01T00:00:00",
        },
      },
    });
  });

  test("a withdrawal routes to withdraw", () => {
    const result = validateEntry(
      draft({ kind: "withdrawal", amount: "500" }),
      held,
    );

    expect(result.ok && result.request.endpoint).toBe("withdrawal");
  });

  test("the account is required before anything else", () => {
    const result = validateEntry(draft({ accountId: null }), held);

    expect(result).toEqual({
      ok: false,
      reason: "Choose the account this belongs to.",
    });
  });

  test("a trade needs an instrument", () => {
    const result = validateEntry(
      draft({ instrumentId: null, quantity: "5", price: "1" }),
      held,
    );

    expect(result.ok).toBe(false);
  });

  test("quantity, price and amount must be positive numbers", () => {
    expect(validateEntry(draft({ quantity: "", price: "1" }), held).ok).toBe(
      false,
    );
    expect(validateEntry(draft({ quantity: "0", price: "1" }), held).ok).toBe(
      false,
    );
    expect(validateEntry(draft({ quantity: "-2", price: "1" }), held).ok).toBe(
      false,
    );
    expect(
      validateEntry(draft({ quantity: "5", price: "abc" }), held).ok,
    ).toBe(false);
    expect(
      validateEntry(draft({ kind: "deposit", amount: "0" }), held).ok,
    ).toBe(false);
  });

  test("the date must be a real calendar day", () => {
    expect(
      validateEntry(
        draft({ quantity: "1", price: "1", date: "2026-02-31" }),
        held,
      ),
    ).toEqual({ ok: false, reason: "Enter the date as YYYY-MM-DD." });
    expect(
      validateEntry(draft({ quantity: "1", price: "1", date: "" }), held).ok,
    ).toBe(false);
  });

  test("a sell beyond the units held is rejected with a readable reason", () => {
    const result = validateEntry(
      draft({ kind: "sell", quantity: "12", price: "200" }),
      held,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(
      "Only 10 units are held in this scope — a sell cannot exceed that.",
    );
  });

  test("a sell of exactly what is held goes through", () => {
    const result = validateEntry(
      draft({ kind: "sell", quantity: "10", price: "200" }),
      held,
    );

    expect(result.ok && result.request.body).toMatchObject({ type: "sell" });
  });

  test("a buy larger than the balance is NOT blocked here", () => {
    // Deliberate: `available` depends on the transaction's own date and
    // the sheet only knows today's balance, so the ledger replay is the
    // authority (docs/adr/0001-dashboard-v2.md § 4).
    const result = validateEntry(
      draft({ quantity: "1000", price: "500" }),
      held,
    );

    expect(result.ok).toBe(true);
  });
});

describe("parseInsufficientFunds — narrowing the 409 body", () => {
  const body = {
    detail: {
      code: "insufficient_cash",
      message: "…",
      account_id: "ira",
      instrument_id: "cash",
      requested: "4650",
      available: "1200",
    },
  };

  test("recognises the structured detail", () => {
    expect(parseInsufficientFunds(body)?.code).toBe("insufficient_cash");
  });

  test("a plain string detail is not one", () => {
    // Every other error path on this API sends one, and treating it as
    // structured is how "[object Object]" reaches the screen.
    expect(parseInsufficientFunds({ detail: "Account not found" })).toBeNull();
    expect(parseInsufficientFunds({})).toBeNull();
    expect(parseInsufficientFunds(null)).toBeNull();
    expect(parseInsufficientFunds("nope")).toBeNull();
  });

  test("an unknown code is not one either", () => {
    expect(
      parseInsufficientFunds({ detail: { ...body.detail, code: "other" } }),
    ).toBeNull();
  });

  test("a missing field is not one either", () => {
    expect(
      parseInsufficientFunds({ detail: { code: "insufficient_cash" } }),
    ).toBeNull();
  });
});

describe("describeEntryError — the rejection, as an instruction", () => {
  test("insufficient cash names the cause and points at the Deposit", () => {
    const message = describeEntryError({
      detail: {
        code: "insufficient_cash",
        message: "…",
        account_id: "ira",
        instrument_id: "cash",
        requested: "4650",
        available: "1200",
      },
      fallback: "unused",
      accountName: "Wells Fargo IRA",
    });

    expect(message).toContain("Not enough cash in Wells Fargo IRA");
    expect(message).toContain("$4,650.00");
    expect(message).toContain("$1,200.00");
    expect(message).toContain("Record the funding Deposit");
  });

  test("insufficient shares talks about units, not about deposits", () => {
    const message = describeEntryError({
      detail: {
        code: "insufficient_shares",
        message: "…",
        account_id: "ira",
        instrument_id: "goog",
        requested: "20",
        available: "12",
      },
      fallback: "unused",
      accountName: "Wells Fargo IRA",
    });

    expect(message).toContain("Not enough units");
    expect(message).toContain("20");
    expect(message).toContain("12");
    expect(message).not.toContain("Deposit");
  });

  test("anything else falls back to the error's own message", () => {
    expect(
      describeEntryError({
        detail: null,
        fallback: "Account not found",
        accountName: null,
      }),
    ).toBe("Account not found");
  });

  test("an unnamed account still reads as a sentence", () => {
    const message = describeEntryError({
      detail: {
        code: "insufficient_cash",
        message: "…",
        account_id: "ira",
        instrument_id: "cash",
        requested: "10",
        available: "0",
      },
      fallback: "unused",
      accountName: null,
    });

    expect(message).toContain("Not enough cash in this account");
  });
});
