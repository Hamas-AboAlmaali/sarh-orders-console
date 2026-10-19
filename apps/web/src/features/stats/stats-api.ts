import type { OrderStats } from "@sarh/shared";
import { getJson } from "../../lib/api-client";

// The endpoint takes up to six seconds by design; anything far beyond that is a hung request.
export const STATS_TIMEOUT_MS = 15_000;

export function fetchOrderStats(signal: AbortSignal): Promise<OrderStats> {
  return getJson<OrderStats>("/api/orders/stats", { signal, timeoutMs: STATS_TIMEOUT_MS });
}
