import { useQuery } from "@tanstack/react-query";
import {
  fetchTimeSeries,
  seedDemoPortfolio,
  type Series,
  type TimeSeriesQuery,
} from "@/lib/api";

/**
 * Seeds the demo portfolio once per session. Idempotent server-side, so
 * calling it on every launch is safe — a user with data of their own is
 * left alone. Modelled as a query rather than a mutation so the screens
 * below it can simply wait on it.
 */
export function useDemoSeed() {
  return useQuery({
    queryKey: ["demo-seed"],
    queryFn: () => seedDemoPortfolio(),
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * One time series — for the chart, and for the range-scoped denominators
 * the Holdings and Accounts rows measure their percentage against (#16).
 *
 * Gated on the demo seed so the very first launch doesn't race an empty
 * portfolio and render a chart with no points. Prices block: the query
 * stays in its loading state until the backend has the history it needs
 * (per #14 — progressive rendering is deliberately deferred to #28).
 *
 * `enabled` narrows that further: the Accounts tab's two series are only
 * worth fetching while that tab is on screen, and react-query keeps the
 * result cached so switching back is instant.
 */
export function usePortfolioSeries(
  query: TimeSeriesQuery,
  options: { enabled?: boolean } = {},
) {
  const seed = useDemoSeed();

  return useQuery<Series[]>({
    queryKey: ["portfolio-series", query],
    queryFn: () => fetchTimeSeries(query),
    enabled: seed.isSuccess && options.enabled !== false,
    retry: false,
  });
}
