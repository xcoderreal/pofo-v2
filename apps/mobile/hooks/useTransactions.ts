import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  fetchPosition,
  type CreateTransactionRequest,
} from "@/lib/api";

export function usePosition(accountId: string | null, instrumentId: string | null) {
  return useQuery({
    queryKey: ["position", accountId, instrumentId],
    queryFn: () => fetchPosition(accountId as string, instrumentId as string),
    enabled: Boolean(accountId && instrumentId),
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransactionRequest) => createTransaction(data),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({
        queryKey: ["position", variables.account_id, variables.instrument_id],
      }),
  });
}
