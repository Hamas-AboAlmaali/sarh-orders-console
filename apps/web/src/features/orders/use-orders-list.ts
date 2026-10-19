import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { orderKeys } from "./order-keys";
import { fetchOrdersPage, type OrderFilters } from "./orders-api";

/**
 * Two independent guards keep a slow, superseded request from ever replacing the latest results:
 * 1. Results are cached per filter combination (the query key), and the component only reads the
 *    entry for its current filters, so a late response lands in an entry nobody is displaying.
 * 2. The AbortSignal is handed to fetch, so React Query cancels the superseded request outright
 *    once its filters are no longer observed.
 */
export function useOrdersList(filters: OrderFilters) {
  return useInfiniteQuery({
    queryKey: orderKeys.list(filters),
    queryFn: ({ pageParam, signal }) => fetchOrdersPage(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Keep showing the previous rows (visibly marked as updating) instead of flashing an empty table.
    placeholderData: keepPreviousData,
  });
}
