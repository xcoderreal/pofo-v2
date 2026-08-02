import { useQuery } from "@tanstack/react-query";
import { fetchPortfolioSummary, type PortfolioSummary } from "@/lib/api";
import { useDemoSeed } from "@/hooks/usePortfolio";

/**
 * Where the portfolio's history begins.
 *
 * The "Max" range is defined as "resolved to the earliest transaction"
 * (docs/design/dashboard_v2/behaviour.md § Ranges and granularity) and
 * nothing else the client holds can supply that date — the positions
 * endpoint returns computed state with no dates on it, and asking the
 * time-series query would mean already knowing how far back to ask.
 *
 * Gated on the demo seed like every other read on launch: fired in
 * parallel it would race the seed and resolve to the null the user had
 * *before* seeding, leaving Max collapsed for the whole session.
 */
export function usePortfolioSummary() {
  const seed = useDemoSeed();

  return useQuery<PortfolioSummary>({
    queryKey: ["portfolio-summary"],
    queryFn: () => fetchPortfolioSummary(),
    enabled: seed.isSuccess,
  });
}
