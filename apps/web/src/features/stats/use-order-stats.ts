import { useQuery } from "@tanstack/react-query";
import { orderKeys } from "../orders/order-keys";
import { fetchOrderStats } from "./stats-api";

/**
 * The request is tied to the component: React Query aborts the signal when the last observer
 * unmounts, so leaving the page cancels the fetch and the server stops waiting too.
 */
export function useOrderStats() {
  return useQuery({
    queryKey: orderKeys.stats(),
    queryFn: ({ signal }) => fetchOrderStats(signal),
    // Each attempt can take six seconds. Silent retries would leave the agent waiting up to 18 s
    // with no feedback, so a failure is shown at once with a single manual retry.
    retry: false,
    // Coming back within a minute shows the last report instead of another multi-second wait.
    staleTime: 60_000,
  });
}
