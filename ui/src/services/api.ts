/**
 * Thin typed wrapper around `fetch` for the Dopgate API (`/api/v1`).
 *
 * - Parses the success envelope (`{ success, message, data }`) and the error
 *   envelope (`{ success: false, error: { CODE: message } }`).
 * - Surfaces every failure as an {@link ApiError} with the HTTP status, the
 *   first error code, the server's message and, for 429, `Retry-After`.
 * - Sends `Authorization: Bearer <access token>` on signed-in calls. The
 *   token comes from the auth store through {@link registerAuth}, which
 *   keeps this module store-free.
 * - On a 401 `TOKEN_INVALID` or `AUTHENTICATION_REQUIRED` it refreshes the
 *   session once (concurrent calls share one refresh) and retries the call.
 *   When the refresh fails the store is told the session is gone.
 */

export const API_BASE = "/api/v1";

/** Header that asks for the refresh token in an HttpOnly cookie. */
export const SESSION_HEADER = "X-Dopgate-Session";

export type ApiErrorCodes = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly codes: ApiErrorCodes;
  /** Seconds to wait before trying again, from `Retry-After` on a 429. */
  readonly retryAfter: number | null;

  constructor(
    status: number,
    codes: ApiErrorCodes,
    retryAfter: number | null = null,
    options?: ErrorOptions,
  ) {
    super(Object.values(codes)[0] ?? "The request failed.", options);
    this.name = "ApiError";
    this.status = status;
    this.codes = codes;
    this.retryAfter = retryAfter;
  }

  /** The first (usually only) error code, e.g. `"EMAIL_TAKEN"`. */
  get code(): string {
    return Object.keys(this.codes)[0] ?? "INTERNAL_ERROR";
  }

  hasCode(code: string): boolean {
    return code in this.codes;
  }
}

export interface AuthHooks {
  /** The current access token, or null when signed out. */
  token: () => string | null;
  /** Gets a new access token. Resolves to whether it worked. */
  refresh: () => Promise<boolean>;
  /** Called when a signed-in call fails and the refresh did too. */
  signedOut: () => void;
}

let hooks: AuthHooks = {
  token: () => null,
  refresh: async () => false,
  signedOut: () => {},
};

/** Registers where tokens come from. Called once by the auth store. */
export function registerAuth(next: AuthHooks): void {
  hooks = next;
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: every 401 waiting on it shares the answer. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= hooks.refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

const RETRYABLE_401 = new Set(["TOKEN_INVALID", "AUTHENTICATION_REQUIRED"]);

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Send the Bearer token and refresh on 401. Defaults to true. */
  auth?: boolean;
  /** Send `X-Dopgate-Session: cookie`, for the cookie session endpoints. */
  cookie?: boolean;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(name, String(value));
  }
  const search = params.toString();
  return `${API_BASE}${path}${search ? `?${search}` : ""}`;
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function parseError(response: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(response);
  try {
    const payload = (await response.json()) as { error?: ApiErrorCodes };
    const codes = payload.error;
    if (codes && typeof codes === "object" && Object.keys(codes).length > 0) {
      return new ApiError(response.status, codes, retryAfter);
    }
  } catch {
    // Not JSON; fall through to a generic error.
  }
  return new ApiError(
    response.status,
    { INTERNAL_ERROR: "The server reported an error." },
    retryAfter,
  );
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers[SESSION_HEADER] = "cookie";
  if (options.auth !== false) {
    const token = hooks.token();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  try {
    return await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: "same-origin",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw options.signal.reason ?? cause;
    throw new ApiError(
      0,
      { NETWORK_ERROR: "Cannot reach the Dopgate server." },
      null,
      { cause },
    );
  }
}

/**
 * Makes one API call and resolves with the envelope's `data` (null for a
 * 204). Throws {@link ApiError} for every failure; network failures have
 * status 0.
 */
export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && options.auth !== false) {
    const error = await parseError(response);
    if (!RETRYABLE_401.has(error.code)) throw error;
    if (!(await refreshOnce())) {
      hooks.signedOut();
      throw error;
    }
    response = await send(path, options);
    if (response.status === 401) {
      hooks.signedOut();
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return null as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    if (options.signal?.aborted) throw options.signal.reason ?? cause;
    throw new ApiError(response.status, {
      INVALID_RESPONSE: "The server returned an unreadable response.",
    });
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    (payload as { success?: unknown }).success !== true
  ) {
    throw new ApiError(response.status, {
      INVALID_RESPONSE: "The server returned an invalid response.",
    });
  }
  return ((payload as { data?: T }).data ?? null) as T;
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

/** Whether `cause` is an API error with `code`. */
export function hasCode(cause: unknown, code: string): boolean {
  return cause instanceof ApiError && cause.hasCode(code);
}

/**
 * The message to show for a failed call: the server's own message for API
 * errors (they are written for people), otherwise `fallback`.
 */
export function errorMessage(cause: unknown, fallback: string): string {
  if (isAbortError(cause)) return "";
  if (cause instanceof ApiError) {
    if (cause.hasCode("RATE_LIMITED")) return rateLimitMessage(cause);
    if (cause.code === "INTERNAL_ERROR" || cause.code === "INVALID_RESPONSE")
      return fallback;
    return cause.message;
  }
  return fallback;
}

/** "Too many attempts. Try again in 30 seconds." */
export function rateLimitMessage(error: ApiError): string {
  const seconds = error.retryAfter;
  if (seconds === null)
    return "Too many attempts. Wait a moment and try again.";
  if (seconds <= 1) return "Too many attempts. Try again in a second.";
  if (seconds < 120)
    return `Too many attempts. Try again in ${seconds} seconds.`;
  return `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`;
}
