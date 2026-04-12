import { useQuery } from "@tanstack/react-query";
import { fetchPositions } from "@/lib/api";

export function usePositions(params?: {
  account_id?: string;
  instrument_id?: string;
}) {
  return useQuery({
    queryKey: ["positions", params],
    queryFn: () => fetchPositions(params),
  });
}
