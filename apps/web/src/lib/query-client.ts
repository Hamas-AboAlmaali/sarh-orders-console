import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, isRetryableError } from "./api-client";

const MAX_RETRIES = 2;

type Options = {
  /** Called when any request comes back 401, e.g. because the session expired mid-shift. */
  onUnauthorized?: () => void;
};

export function createQueryClient({ onUnauthorized }: Options = {}): QueryClient {
  const handleError = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) onUnauthorized?.();
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Refetching an infinite list re-requests every loaded page; agents refresh explicitly instead.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => isRetryableError(error) && failureCount < MAX_RETRIES,
      },
    },
  });
}
