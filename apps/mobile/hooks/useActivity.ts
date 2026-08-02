import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { useDemoSeed } from "@/hooks/usePortfolio";
import { useSharedViewState } from "@/hooks/useViewState";
import {
  activityScopeLabel,
  buildActivity,
  type ActivityMonth,
} from "@/lib/activity";
import { fetchLedger, type LedgerEntry, type LedgerQuery } from "@/lib/api";
import { firstError } from "@/lib/dashboard";

/** The raw feed. Gated on the demo seed like every other read on launch —
 * racing it resolves to the empty ledger the user had *before* seeding,
 * and nothing invalidates it afterwards. */
export function useLedger(query: LedgerQuery = {}) {
  const seed = useDemoSeed();

  return useQuery<LedgerEntry[]>({
    queryKey: ["ledger", query],
    queryFn: () => fetchLedger(query),
    enabled: seed.isSuccess,
    retry: false,
  });
}

export interface Activity {
  months: ActivityMonth[];
  /** Rows actually shown — the paired CASH legs are already gone, so this
   * is what the header counts. */
  count: number;
  /** `20 transactions`, or `3 matching` once a chip is applied. */
  scopeLabel: string;
  isFiltered: boolean;
  isPending: boolean;
  errorMessage: string | null;
}

/**
 * Everything the Activity screen renders.
 *
 * **The scope is the shared view state's, unfiltered by metric.** The
 * Portfolio tab sends `scopeParams`, which drops a dimension the current
 * metric doesn't have (`lib/drilldown.ts`) — the ledger has both
 * dimensions on every row, always, so that repair has nothing to do here
 * and applying it would silently widen the feed past the chips on screen.
 * What the user can see selected is what the feed is narrowed to
 * (docs/design/dashboard_v2/behaviour.md § Activity).
 *
 * The catalog and accounts come along because a row says `GOOG` and
 * `Wells Fargo Brokerage`, not `goog` and an id — and because which
 * instrument is CASH is the catalog's `asset_class`, not a hardcoded id.
 */
export function useActivity(): Activity {
  const view = useSharedViewState();
  const { instrumentId, accountId } = view.state;

  const query = useMemo<LedgerQuery>(() => {
    const next: LedgerQuery = {};
    if (instrumentId !== null) next.instruments = [instrumentId];
    if (accountId !== null) next.accounts = [accountId];
    return next;
  }, [instrumentId, accountId]);

  const ledger = useLedger(query);
  const instruments = useInstruments();
  const accounts = useAccounts();

  const months = useMemo(
    () =>
      buildActivity({
        entries: ledger.data,
        instruments: instruments.data,
        accounts: accounts.data,
      }),
    [ledger.data, instruments.data, accounts.data],
  );

  const count = useMemo(
    () => months.reduce((total, month) => total + month.rows.length, 0),
    [months],
  );
  const isFiltered = instrumentId !== null || accountId !== null;

  return {
    months,
    count,
    isFiltered,
    scopeLabel: activityScopeLabel(count, isFiltered),
    isPending:
      ledger.isPending || instruments.isPending || accounts.isPending,
    errorMessage: firstError([
      ledger.error?.message,
      instruments.error?.message,
      accounts.error?.message,
    ]),
  };
}
