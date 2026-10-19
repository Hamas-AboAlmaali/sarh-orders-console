import type { LoginInput, SessionUser } from "@sarh/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, getJson, postJson } from "../../lib/api-client";

const sessionKey = ["auth", "session"] as const;

type SessionResponse = { user: SessionUser };

/** The signed-in user, or null. The session cookie is httpOnly, so asking the server is the only way to know. */
async function fetchSession(signal: AbortSignal): Promise<SessionUser | null> {
  try {
    return (await getJson<SessionResponse>("/api/auth/me", { signal })).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: Infinity,
  });
}

/** Drops everything cached for the previous user, so the next one never sees it. */
export function endSession(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionKey[0] });
  queryClient.setQueryData(sessionKey, null);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => postJson<SessionResponse>("/api/auth/login", input),
    retry: false,
    onSuccess: ({ user }) => queryClient.setQueryData(sessionKey, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<void>("/api/auth/logout", {}),
    onSettled: () => endSession(queryClient),
  });
}
