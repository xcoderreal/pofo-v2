import { useQuery } from "@tanstack/react-query";
import { fetchGains } from "@/lib/api";

export function useGains(params?: {
  account_id?: string;
  instrument_id?: string;
}) {
  return useQuery({
    queryKey: ["gains", params],
    queryFn: () => fetchGains(params),
  });
}
