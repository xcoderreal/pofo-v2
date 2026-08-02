import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { usePortfolioSeries } from "@/hooks/usePortfolio";
import { usePositions } from "@/hooks/usePositions";
import { useRecordEntry } from "@/hooks/useTransactions";
import { useSharedViewState } from "@/hooks/useViewState";
import { WriteRejectedError } from "@/lib/api";
import type { Scope } from "@/lib/drilldown";
import { accountHoldsInstruments, cashBalanceFor } from "@/lib/positions";
import { toApiDate } from "@/lib/timeseries";
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
  unitsHeld,
  unitsHeldLabel,
  validateEntry,
  type EntryDraft,
  type EntryField,
  type EntryKind,
} from "@/lib/transactionEntry";

/** How far back the price prefill looks for the most recent close. Wide
 * enough to clear a weekend plus a holiday; the backend widens it by
 * another seven days at the start boundary (docs/domain-model.md). */
const PRICE_LOOKBACK_DAYS = 14;

const CASH_ASSET_CLASS = "cash";

export interface EntryPickerOption {
  id: string;
  label: string;
  note: string;
  selected: boolean;
}

export interface TransactionEntry {
  draft: EntryDraft;
  scope: Scope;
  fields: readonly EntryField[];
  title: string;
  contextNote: string;
  ctaLabel: string;
  /** The Sell hint (units held) or the Buy hint (cash available) — the two
   * halves of #22's "validation, both directions". Null for a Deposit or
   * Withdrawal, which neither draws down a holding nor needs funding. */
  hint: string | null;
  /** Why the CTA is disabled, or null when the draft is writable. */
  blockedReason: string | null;
  /** The server's verdict on the last attempt, already turned into an
   * instruction. */
  errorMessage: string | null;
  isSubmitting: boolean;
  accountOptions: EntryPickerOption[];
  instrumentOptions: EntryPickerOption[];
  isFromContext: (field: EntryField) => boolean;
  setKind: (kind: EntryKind) => void;
  setAccount: (accountId: string) => void;
  setInstrument: (instrumentId: string) => void;
  setField: (field: "quantity" | "price" | "amount" | "date", text: string) => void;
  submit: () => void;
}

/**
 * Everything the transaction entry sheet renders and does.
 *
 * A screen-level hook in the shape `useDashboard` already established:
 * the sheet reads four resources and writes one, and putting that cascade
 * in the component would be the opposite of "pages are thin". Every
 * *decision* it makes — which fields show, what prefills, whether a sell
 * fits, what a rejection means — is a pure function in
 * `lib/transactionEntry.ts`; what is left here is the wiring.
 *
 * Mounted with the sheet rather than living above it, so opening the sheet
 * *is* the draft's initialisation: no reset-on-open effect, and no way for
 * a stale draft to outlive the scope it was prefilled from.
 */
export function useTransactionEntry(options: {
  onClose: () => void;
}): TransactionEntry {
  const { onClose } = options;
  const view = useSharedViewState();
  const scope: Scope = {
    instrumentId: view.state.instrumentId,
    accountId: view.state.accountId,
  };

  const accounts = useAccounts();
  const instruments = useInstruments();
  const positions = usePositions();
  const record = useRecordEntry();
  // Stable across renders (react-query), so every callback below can name
  // them as dependencies instead of suppressing the rule.
  const { mutate, reset } = record;

  const [draft, setDraft] = useState<EntryDraft>(() =>
    initialDraft({
      scope,
      today: toApiDate(new Date()),
      accountHoldsInstruments: accountHoldsInstruments({
        positions: positions.data,
        instruments: instruments.data,
        accountId: scope.accountId ?? "",
      }),
    }),
  );
  // A price the user typed is theirs; the prefill must not overwrite it
  // when the market price finally arrives, nor when the instrument changes.
  const [priceTouched, setPriceTouched] = useState(false);

  // ─── Price prefill ──────────────────────────────────────────
  // `market_price` for the one chosen instrument, rather than
  // `market_value / share_count` off the positions rows already loaded:
  // the two agree wherever both exist, but the derived one is undefined
  // for an instrument you don't hold yet — which is every first buy.
  const priceWindow = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - PRICE_LOOKBACK_DAYS);
    return { start: toApiDate(start), end: toApiDate(end) };
  }, []);

  const wantsPrice = !isCashKind(draft.kind) && draft.instrumentId !== null;
  const priceSeries = usePortfolioSeries(
    {
      metric: "market_price",
      ...priceWindow,
      granularity: "daily",
      mode: "point_in_time",
      groupBy: "none",
      // No `accounts`: market_price has no account dimension and the API
      // rejects one outright (docs/domain-model.md § Query interface).
      instruments: draft.instrumentId ? [draft.instrumentId] : undefined,
    },
    { enabled: wantsPrice },
  );

  const latestPrice = wantsPrice
    ? latestPriceFromSeries(priceSeries.data)
    : null;

  useEffect(() => {
    if (latestPrice === null || priceTouched) return;
    setDraft((current) =>
      current.price === "" ? { ...current, price: latestPrice.toFixed(2) } : current,
    );
  }, [latestPrice, priceTouched]);

  // ─── Labels ─────────────────────────────────────────────────

  const accountName =
    (accounts.data ?? []).find((a) => a.id === draft.accountId)?.name ?? null;
  const symbol =
    (instruments.data ?? []).find((i) => i.id === draft.instrumentId)?.symbol ??
    null;

  const held = unitsHeld({
    positions: positions.data,
    instrumentId: draft.instrumentId,
    accountId: draft.accountId,
  });
  // An account with no CASH position at all has zero cash, not unknown
  // cash. `cashBalanceFor` answers null to both because the Accounts
  // list's question is "is there a cash row to draw", and there isn't —
  // but the Buy hint's question is "what can this pay with", and for a
  // brand-new account the honest answer is $0.00. Gated on the fetch
  // having landed so the sheet never asserts a balance it hasn't read.
  const cash =
    draft.accountId === null || !positions.isSuccess
      ? null
      : (cashBalanceFor({
          positions: positions.data,
          instruments: instruments.data,
          accountId: draft.accountId,
        }) ?? 0);

  const validation = validateEntry(draft, { unitsHeld: held });

  // ─── Pickers ────────────────────────────────────────────────
  // Chosen from, never created here: instrument creation is #23 and
  // account creation is #24, so this list is exactly what already exists.

  const accountOptions = useMemo<EntryPickerOption[]>(
    () =>
      (accounts.data ?? []).map((account) => ({
        id: account.id,
        label: account.name,
        note: account.institution,
        selected: account.id === draft.accountId,
      })),
    [accounts.data, draft.accountId],
  );

  const instrumentOptions = useMemo<EntryPickerOption[]>(
    () =>
      (instruments.data ?? [])
        // CASH is not a pickable instrument: a cash movement is a Deposit
        // or a Withdrawal here, not a trade of something called "USD"
        // (docs/domain-model.md).
        .filter((instrument) => instrument.asset_class !== CASH_ASSET_CLASS)
        .map((instrument) => ({
          id: instrument.id,
          label: instrument.symbol,
          note: instrument.name,
          selected: instrument.id === draft.instrumentId,
        })),
    [instruments.data, draft.instrumentId],
  );

  // ─── Transitions ────────────────────────────────────────────

  // Every edit clears the last rejection: a message about the figures that
  // were submitted is wrong the moment one of them changes.
  const setKind = useCallback(
    (kind: EntryKind) => {
      reset();
      setDraft((current) => ({ ...current, kind }));
    },
    [reset],
  );

  const setAccount = useCallback(
    (accountId: string) => {
      reset();
      setDraft((current) => ({ ...current, accountId }));
    },
    [reset],
  );

  const setInstrument = useCallback(
    (instrumentId: string) => {
      reset();
      setDraft((current) => ({
        ...current,
        instrumentId,
        // A prefilled price belongs to the instrument it was fetched for;
        // clearing it lets the effect above refill for the new one. A
        // typed price is left alone.
        price: priceTouched ? current.price : "",
      }));
    },
    [priceTouched, reset],
  );

  const setField = useCallback(
    (field: "quantity" | "price" | "amount" | "date", text: string) => {
      if (field === "price") setPriceTouched(true);
      reset();
      setDraft((current) => ({ ...current, [field]: text }));
    },
    [reset],
  );

  const submit = useCallback(() => {
    if (!validation.ok) return;
    mutate(validation.request, { onSuccess: onClose });
  }, [mutate, onClose, validation]);

  const rejection = record.error;
  const errorMessage =
    rejection == null
      ? null
      : describeEntryError({
          detail:
            rejection instanceof WriteRejectedError
              ? rejection.insufficientFunds
              : null,
          fallback: rejection.message,
          accountName,
        });

  return {
    draft,
    scope,
    fields: entryFields(draft.kind),
    title: entrySheetTitle({ symbol, accountName }),
    contextNote: contextNote(scope),
    ctaLabel: entryCtaLabel(draft, { symbol, accountName }),
    // Both directions of #22's validation. The Buy hint waits for an
    // account: "cash available in the account is unknown" is true but
    // useless before one is chosen, and the blocked-reason line already
    // says to choose one.
    hint:
      draft.kind === "sell"
        ? unitsHeldLabel(held, accountName)
        : draft.kind === "buy" && draft.accountId !== null
          ? cashAvailableLabel(cash, accountName)
          : null,
    blockedReason: validation.ok ? null : validation.reason,
    errorMessage,
    isSubmitting: record.isPending,
    accountOptions,
    instrumentOptions,
    isFromContext: (field: EntryField) => isFromContext(field, draft, scope),
    setKind,
    setAccount,
    setInstrument,
    setField,
    submit,
  };
}
