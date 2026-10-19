export type ValidationIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string; issues?: ValidationIssue[] } };

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return new ApiError(
    response.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ??
      (response.status >= 500
        ? "The server is not responding"
        : `Request failed with status ${response.status}`),
    body?.error?.issues,
  );
}

/** Network failures, timeouts and 5xx may succeed on a second attempt; a 4xx will not. */
export function isRetryableError(error: unknown): boolean {
  return !(error instanceof ApiError && error.status < 500);
}

function toRequestError(error: unknown, timeoutMs: number | undefined): unknown {
  // Browsers word network failures differently ("Failed to fetch", "Load failed").
  if (error instanceof TypeError) return new Error("Could not reach the server", { cause: error });
  if (error instanceof DOMException && error.name === "TimeoutError" && timeoutMs !== undefined) {
    return new Error(`The server did not answer within ${timeoutMs / 1000} seconds`, {
      cause: error,
    });
  }
  return error;
}

type RequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Gives up when the response has not fully arrived after this long. */
  timeoutMs?: number;
};

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number | undefined) {
  if (timeoutMs === undefined) return signal ?? null;
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request<T>(
  path: string,
  init: RequestInit,
  { headers, signal, timeoutMs }: RequestOptions,
): Promise<T> {
  try {
    const response = await fetch(path, {
      ...init,
      signal: withTimeout(signal, timeoutMs),
      headers: { Accept: "application/json", ...init.headers, ...headers },
    });
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    throw toRequestError(error, timeoutMs);
  }
}

export function getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, {}, options);
}

export function postJson<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(
    path,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    options,
  );
}

export function deleteRequest(path: string): Promise<void> {
  return request<void>(path, { method: "DELETE" }, {});
}
