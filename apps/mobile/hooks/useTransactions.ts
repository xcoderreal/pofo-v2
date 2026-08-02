import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDeposit,
  createTransaction,
  createWithdrawal,
  fetchPosition,
} from "@/lib/api";
import type { EntryRequest } from "@/lib/transactionEntry";

export function usePosition(accountId: string | null, instrumentId: string | null) {
  return useQuery({
    queryKey: ["position", accountId, instrumentId],
    queryFn: () => fetchPosition(accountId as string, instrumentId as string),
    enabled: Boolean(accountId && instrumentId),
  });
}

/**
 * Every read a new Transaction can change.
 *
 * Listed rather than invalidating everything, but listed *completely*: the
 * entry sheet is the only way data gets in, so "the affected views update
 * without a manual refresh" (#22) is entirely a question of whether this
 * array is right. Each entry is a query-key prefix, so it catches every
 * scoped variant — `["positions", {accounts:[…]}]` and the unscoped one
 * alike.
 *
 * `portfolio-summary` is in here because it is the earliest transaction
 * date, and a back-dated entry moves it — which moves what the `Max` range
 * resolves to.
 *
 * The catalogs (`accounts`, `instruments`) are deliberately absent: this
 * sheet picks from what already exists and creates neither (#23, #24).
 */
const INVALIDATED_BY_A_WRITE = [
  ["positions"],
  ["portfolio-series"],
  ["ledger"],
  ["portfolio-summary"],
  ["position"],
] as const;

/**
 * Record whatever the entry sheet built — a trade, a Deposit or a
 * Withdrawal.
 *
 * One mutation over three routes rather than three hooks, because the
 * caller is one form with a type toggle: which endpoint a draft resolves
 * to is `validateEntry`'s decision (`lib/transactionEntry.ts`), already
 * made by the time anything is submitted.
 */
export function useRecordEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: EntryRequest) => {
      switch (request.endpoint) {
        case "transaction":
          return createTransaction(request.body);
        case "deposit":
          return createDeposit(request.body);
        case "withdrawal":
          return createWithdrawal(request.body);
      }
    },
    onSuccess: () =>
      Promise.all(
        INVALIDATED_BY_A_WRITE.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}
