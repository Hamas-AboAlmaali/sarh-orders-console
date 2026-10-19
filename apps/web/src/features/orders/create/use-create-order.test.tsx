import { IDEMPOTENCY_KEY_HEADER, type CreateOrderInput, type OrderDetail } from "@sarh/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateOrder } from "./use-create-order";

const order: CreateOrderInput = {
  customerName: "Sara Ali",
  customerEmail: "sara@example.com",
  items: [{ productName: "Lamp", quantity: 1, unitPriceCents: 4_500 }],
  totalCents: 4_500,
};

const created: OrderDetail = {
  id: 1,
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  status: "pending",
  totalCents: 4_500,
  itemCount: 1,
  createdAt: "2026-10-18T12:00:00.000Z",
  items: [{ id: 1, productName: "Lamp", quantity: 1, unitPriceCents: 4_500 }],
};

type Outcome = "ok" | "network-error" | "bad-request";

/** Answers each call with the next outcome and records the idempotency key every request carried. */
function stubFetch(outcomes: Outcome[]): string[] {
  const keys: string[] = [];
  vi.stubGlobal("fetch", async (_input: string, init: RequestInit) => {
    keys.push(new Headers(init.headers).get(IDEMPOTENCY_KEY_HEADER)!);
    const outcome = outcomes.shift() ?? "ok";
    if (outcome === "network-error") throw new TypeError("Failed to fetch");
    if (outcome === "bad-request") {
      return Response.json(
        { error: { code: "validation_error", message: "Invalid" } },
        { status: 400 },
      );
    }
    return Response.json(created, { status: 201 });
  });
  return keys;
}

function renderCreateOrder() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCreateOrder(), { wrapper });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCreateOrder idempotency keys", () => {
  it("retries a failed network request automatically with the same key", async () => {
    const keys = stubFetch(["network-error", "ok"]);
    const { result } = renderCreateOrder();

    await act(() => result.current.createOrder(order));

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("sends the same key when the agent double-clicks submit", async () => {
    const keys = stubFetch(["ok", "ok"]);
    const { result } = renderCreateOrder();

    await act(() =>
      Promise.all([result.current.createOrder(order), result.current.createOrder(order)]),
    );

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("uses a new key for the next order once the previous one succeeded", async () => {
    const keys = stubFetch(["ok", "ok"]);
    const { result } = renderCreateOrder();

    await act(() => result.current.createOrder(order));
    await act(() => result.current.createOrder(order));

    expect(keys[1]).not.toBe(keys[0]);
  });

  it("uses a new key when the agent edits the order after a failed attempt", async () => {
    const keys = stubFetch(["bad-request", "ok"]);
    const { result } = renderCreateOrder();

    await act(() => result.current.createOrder(order).catch(() => undefined));
    await act(() => result.current.createOrder({ ...order, customerName: "Sara A. Ali" }));

    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
