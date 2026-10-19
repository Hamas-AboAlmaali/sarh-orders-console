import { IDEMPOTENCY_KEY_HEADER, type CreateOrderInput, type OrderDetail } from "@sarh/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { isRetryableError, postJson } from "../../../lib/api-client";
import { orderKeys } from "../order-keys";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

type CreateOrderVariables = { input: CreateOrderInput; idempotencyKey: string };

/**
 * One idempotency key per intended order. Double-clicks, automatic retries and manual "try again"
 * all resend the same key, so the server creates the order at most once. The key changes only when
 * the order itself changes (a different payload is a different order) or after a success.
 */
export function useCreateOrder() {
  const queryClient = useQueryClient();
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  const mutation = useMutation({
    mutationFn: ({ input, idempotencyKey }: CreateOrderVariables) =>
      postJson<OrderDetail>("/api/orders", input, {
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        timeoutMs: REQUEST_TIMEOUT_MS,
      }),
    // Retrying a POST is only safe because every retry carries the same idempotency key.
    retry: (failureCount, error) => isRetryableError(error) && failureCount < MAX_RETRIES,
    onSuccess: () => {
      attempt.current = null;
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });

  function createOrder(input: CreateOrderInput): Promise<OrderDetail> {
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) {
      attempt.current = { key: crypto.randomUUID(), payload };
    }
    return mutation.mutateAsync({ input, idempotencyKey: attempt.current.key });
  }

  // mutate/mutateAsync are left out on purpose: calling them directly would skip the key logic above.
  const { isPending, failureCount, error, reset } = mutation;
  return { createOrder, isPending, failureCount, error, reset };
}
