import type { OrderFilters } from "./orders-api";

/** Invalidating `all` after a create or delete refreshes both the list and the stats. */
export const orderKeys = {
  all: ["orders"] as const,
  list: (filters: OrderFilters) => [...orderKeys.all, "list", filters] as const,
  stats: () => [...orderKeys.all, "stats"] as const,
};
