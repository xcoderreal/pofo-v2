import { useQuery } from "@tanstack/react-query";
import { fetchPositions, type PositionRow, type PositionsQuery } from "@/lib/api";
import { useDemoSeed } from "@/hooks/usePortfolio";

/**
 * The batched positions endpoint — one call for every computed Position
 * in scope (docs/adr/0001-dashboard-v2.md § 5).
 *
 * Gated on the demo seed for the same reason the chart is: on a very
 * first launch there is nothing to list until seeding has run.
 */
export function usePositions(query: PositionsQuery = {}) {
  const seed = useDemoSeed();

  return useQuery<PositionRow[]>({
    queryKey: ["positions", query],
    queryFn: () => fetchPositions(query),
    enabled: seed.isSuccess,
    retry: false,
  });
}
