import { useSyncExternalStore } from "react";

export type View = "orders" | "overview";

export const VIEW_HREFS: Record<View, string> = { orders: "#/orders", overview: "#/overview" };

function readView(): View {
  return window.location.hash === VIEW_HREFS.overview ? "overview" : "orders";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Two views do not justify a router; the hash keeps them linkable and the back button working. */
export function useHashView(): View {
  return useSyncExternalStore(subscribe, readView);
}
