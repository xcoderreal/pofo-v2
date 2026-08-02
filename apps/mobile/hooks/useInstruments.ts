import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createInstrument,
  fetchInstruments,
  type CreateInstrumentRequest,
} from "@/lib/api";
import { useDemoSeed } from "@/hooks/usePortfolio";

/**
 * Gated on the demo seed. The catalog is what tells a Holdings row its
 * symbol, its name, and — the one that matters — that CASH is CASH and
 * must not be listed. Racing the seed resolves it to an empty catalog,
 * and rows then render their raw ids with a stray cash row among them.
 */
export function useInstruments() {
  const seed = useDemoSeed();

  return useQuery({
    queryKey: ["instruments"],
    queryFn: () => fetchInstruments(),
    enabled: seed.isSuccess,
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
