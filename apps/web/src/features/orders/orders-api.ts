import type { ListOrdersQuery, OrdersPage } from "@sarh/shared";
import { getJson } from "../../lib/api-client";

export type OrderFilters = Pick<ListOrdersQuery, "search" | "status" | "sort" | "direction">;

export function fetchOrdersPage(
  filters: OrderFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<OrdersPage> {
  const params = new URLSearchParams({ sort: filters.sort, direction: filters.direction });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return getJson<OrdersPage>(`/api/orders?${params}`, { signal });
}
