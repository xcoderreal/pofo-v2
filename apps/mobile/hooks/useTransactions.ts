import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  deleteTransaction,
  fetchTransactions,
  type CreateTransactionRequest,
} from "@/lib/api";

export function useTransactions(params?: {
  account_id?: string;
  instrument_id?: string;
}) {
  return useQuery({
    queryKey: ["transactions", params],
    queryFn: () => fetchTransactions(params),
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransactionRequest) => createTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      queryClient.invalidateQueries({ queryKey: ["gains"] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      queryClient.invalidateQueries({ queryKey: ["gains"] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}
