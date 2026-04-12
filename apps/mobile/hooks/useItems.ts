import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createItem,
  deleteItem,
  fetchItem,
  fetchItems,
  type CreateItemRequest,
} from "@/lib/api";

export function useItems(params?: { tag?: string; category_id?: string }) {
  return useQuery({
    queryKey: ["items", params],
    queryFn: () => fetchItems(params),
  });
}

export function useItem(id: string) {
  return useQuery({
    queryKey: ["items", id],
    queryFn: () => fetchItem(id),
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: CreateItemRequest) => createItem(item),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}
