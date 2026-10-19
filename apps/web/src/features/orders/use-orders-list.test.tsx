import type { OrderStatus, OrdersPage } from "@sarh/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderFilters } from "./orders-api";
import { useOrdersList } from "./use-orders-list";

type PendingRequest = {
  status: OrderStatus;
  signal: AbortSignal;
  respond: () => void;
};

/**
 * Replaces fetch with requests that stay pending until the test answers them, so responses can be
 * delivered in any order. `honourAbort: false` simulates a response that was already on the wire
 * when the request was cancelled, which is exactly the case abort alone cannot cover.
 */
function stubFetch({ honourAbort }: { honourAbort: boolean }): PendingRequest[] {
  const requests: PendingRequest[] = [];

  vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
    const status = new URL(input, "http://localhost").searchParams.get("status") as OrderStatus;
    const signal = init.signal!;

    return new Promise<Response>((resolve, reject) => {
      if (honourAbort) {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }
      const page: OrdersPage = {
        items: [
          {
            id: requests.length + 1,
            customerName: `Customer for ${status}`,
            customerEmail: `${status}@example.test`,
            status,
            totalCents: 1_000,
            itemCount: 1,
            createdAt: "2026-10-01T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      };
      requests.push({ status, signal, respond: () => resolve(Response.json(page)) });
    });
  });

  return requests;
}

function renderOrdersList(initialStatus: OrderStatus) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const filtersFor = (status: OrderStatus): OrderFilters => ({
    search: undefined,
    status,
    sort: "createdAt",
    direction: "desc",
  });

  const hook = renderHook(({ status }) => useOrdersList(filtersFor(status)), {
    wrapper,
    initialProps: { status: initialStatus },
  });
  return { ...hook, changeStatus: (status: OrderStatus) => hook.rerender({ status }) };
}

const displayedStatuses = (data: { pages: OrdersPage[] } | undefined) =>
  data?.pages.flatMap((page) => page.items.map((order) => order.status));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOrdersList under rapid filter changes", () => {
  it("cancels the requests for filters the user has already moved past", async () => {
    const requests = stubFetch({ honourAbort: true });
    const { result, changeStatus } = renderOrdersList("paid");

    changeStatus("shipped");
    changeStatus("cancelled");
    await waitFor(() => expect(requests).toHaveLength(3));

    expect(requests.map((request) => request.signal.aborted)).toEqual([true, true, false]);

    act(() => requests[2]!.respond());
    await waitFor(() => expect(displayedStatuses(result.current.data)).toEqual(["cancelled"]));
  });

  it("never lets an earlier, slower response replace the latest results", async () => {
    const requests = stubFetch({ honourAbort: false });
    const { result, changeStatus } = renderOrdersList("paid");

    changeStatus("shipped");
    changeStatus("cancelled");
    await waitFor(() => expect(requests).toHaveLength(3));

    // The latest request answers first; the two superseded ones arrive afterwards, out of order.
    act(() => requests[2]!.respond());
    await waitFor(() => expect(displayedStatuses(result.current.data)).toEqual(["cancelled"]));

    act(() => requests[0]!.respond());
    act(() => requests[1]!.respond());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(displayedStatuses(result.current.data)).toEqual(["cancelled"]);
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it("shows the latest results even when an older response arrives after it is requested", async () => {
    const requests = stubFetch({ honourAbort: false });
    const { result, changeStatus } = renderOrdersList("paid");

    changeStatus("shipped");
    changeStatus("cancelled");
    await waitFor(() => expect(requests).toHaveLength(3));

    // Superseded responses land first, while the latest request is still in flight.
    act(() => requests[1]!.respond());
    act(() => requests[0]!.respond());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(displayedStatuses(result.current.data)).not.toEqual(["shipped"]);
    expect(displayedStatuses(result.current.data)).not.toEqual(["paid"]);

    act(() => requests[2]!.respond());
    await waitFor(() => expect(displayedStatuses(result.current.data)).toEqual(["cancelled"]));
  });
});
