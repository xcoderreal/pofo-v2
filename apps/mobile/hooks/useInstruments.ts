import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createInstrument,
  deleteInstrument,
  fetchInstruments,
  type CreateInstrumentRequest,
} from "@/lib/api";

export function useInstruments() {
  return useQuery({
    queryKey: ["instruments"],
    queryFn: fetchInstruments,
  });
}

export function useCreateInstrument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInstrumentRequest) => createInstrument(data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["instruments"] }),
  });
}

export function useDeleteInstrument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteInstrument(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["instruments"] }),
  });
}
