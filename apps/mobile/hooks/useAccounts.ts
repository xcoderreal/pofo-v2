import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  type CreateAccountRequest,
} from "@/lib/api";
import { useDemoSeed } from "@/hooks/usePortfolio";

/**
 * Gated on the demo seed, like every other read on launch: fired in
 * parallel with it, this races the seed and resolves to the empty list
 * the user had *before* seeding — and nothing invalidates it afterwards,
 * so the Accounts tab would sit empty for the whole session.
 */
export function useAccounts() {
  const seed = useDemoSeed();

  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => fetchAccounts(),
    enabled: seed.isSuccess,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAccountRequest) => createAccount(data),
    // Only the catalog moves. A brand-new account has no Transactions, so
    // no computed read can have changed — but the catalog is what makes it
    // selectable as a transaction target (#24 AC 3) and what the Accounts
    // list is built from.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

/**
 * Every read a cascade delete can change.
 *
 * A superset of `INVALIDATED_BY_A_WRITE` (`hooks/useTransactions.ts`):
 * removing an account removes Transactions, so everything a *write*
 * invalidates is invalidated here too — plus `accounts` itself, which a
 * write never touches because the entry sheet only ever picks from the
 * catalog it was given.
 *
 * Each entry is a query-key prefix, so it catches every scoped variant —
 * `["ledger", {accounts:[…]}]` and the unscoped one alike. That matters
 * more here than for a write: the deleted account's own scoped queries are
 * cached under keys naming an id that no longer resolves.
 */
const INVALIDATED_BY_A_CASCADE = [
  ["accounts"],
  ["positions"],
  ["portfolio-series"],
  ["ledger"],
  ["portfolio-summary"],
  ["position"],
] as const;

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => deleteAccount(accountId),
    onSuccess: () =>
      Promise.all(
        INVALIDATED_BY_A_CASCADE.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}
