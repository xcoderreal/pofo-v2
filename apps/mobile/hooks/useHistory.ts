import { useQuery } from "@tanstack/react-query";
import { fetchHistory } from "@/lib/api";

export function useHistory(params?: { account_id?: string }) {
  return useQuery({
    queryKey: ["history", params],
    queryFn: () => fetchHistory(params),
  });
}
