import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAccount,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}
