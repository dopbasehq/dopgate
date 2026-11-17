// HTTP client for API tests. Each client is one caller: nobody, a user of
// the app, an admin in the console, or a backend with the service key. It
// sends its bearer token on every call and keeps the cookies it is given,
// the way a browser would.
import {
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { recordHit } from "./record.ts";

export type ApiResult<T = any> = {
  status: number;
  ok: boolean;
  /** Parsed JSON body, or the raw text when it isn't JSON. */
  body: any;
  /** `body.data` from the `{ success, message, data }` envelope. */
  data: T;
  /** `body.message`, the success code, e.g. `SIGNED_IN`. */
  message: string | undefined;
  /** The first error code of a failed call, e.g. `EMAIL_TAKEN`. */
  code: string | undefined;
  headers: Record<string, string>;
  /** Each Set-Cookie header, whole. */
  setCookies: string[];
};

export type ApiCall = {
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
};

export type SendOptions = {
  headers?: Record<string, string>;
  /** false for setup calls that must not count toward coverage. */
  record?: boolean;
  /** false to see a redirect itself instead of the page it leads to. */
  followRedirects?: boolean;
  /**
   * The bearer token for this call. `null` sends none, whatever the client
   * holds. Left out, the client's own token is sent.
   */
  token?: string | null;
};

const PREFIX = "/api/v1";

/** Asks for the refresh token in an HttpOnly cookie instead of the body. */
export const COOKIE_MODE = { "X-Dopgate-Session": "cookie" } as const;

/** What a sign-in answers: tokens and who signed in. */
export type Tokens = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string | null;
  user?: Record<string, any>;
  admin?: Record<string, any>;
};

/** `/health` → `/api/v1/health`; `/api/…` and `/.well-known/…` pass through. */
export function apiPath(path: string): string {
  if (path.startsWith("/api/") || path === "/api") return path;
  if (path.startsWith("/.well-known/")) return path;
  return `${PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiClient {
  readonly label: string;
  /** The bearer token sent on every call, when the client has one. */
  token: string | undefined;
  private readonly context: APIRequestContext;
  private readonly calls: ApiCall[];

  constructor(
    label: string,
    context: APIRequestContext,
    calls: ApiCall[],
    token?: string,
  ) {
    this.label = label;
    this.context = context;
    this.calls = calls;
    this.token = token;
  }

  static async create(
    baseURL: string,
    label: string,
    calls: ApiCall[],
    token?: string,
  ): Promise<ApiClient> {
    const context = await request.newContext({ baseURL });
    return new ApiClient(label, context, calls, token);
  }

  async send<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts: SendOptions = {},
  ): Promise<ApiResult<T>> {
    const url = apiPath(path);
    // Setup calls don't count toward coverage.
    if (opts.record !== false)
      recordHit("api", `${method} ${url.split("?")[0]}`);
    const token = opts.token === undefined ? this.token : opts.token;
    const auth: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const response: APIResponse = await this.context.fetch(url, {
      method,
      headers: { ...auth, ...opts.headers },
      data: body === undefined ? undefined : body,
      ...(opts.followRedirects === false ? { maxRedirects: 0 } : {}),
    });
    const text = await response.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON: keep the text.
    }
    this.calls.push({
      method,
      path: url,
      requestBody: body,
      status: response.status(),
      responseBody: parsed,
    });
    if (this.calls.length > 10) this.calls.shift();
    const error = parsed?.error;
    return {
      status: response.status(),
      ok: response.ok(),
      body: parsed,
      data: parsed?.data as T,
      message: typeof parsed?.message === "string" ? parsed.message : undefined,
      code:
        error && typeof error === "object" ? Object.keys(error)[0] : undefined,
      headers: response.headers(),
      setCookies: response
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value),
    };
  }

  get<T = any>(path: string, opts?: SendOptions) {
    return this.send<T>("GET", path, undefined, opts);
  }
  post<T = any>(path: string, body?: unknown, opts?: SendOptions) {
    return this.send<T>("POST", path, body ?? {}, opts);
  }
  put<T = any>(path: string, body?: unknown, opts?: SendOptions) {
    return this.send<T>("PUT", path, body ?? {}, opts);
  }
  patch<T = any>(path: string, body?: unknown, opts?: SendOptions) {
    return this.send<T>("PATCH", path, body ?? {}, opts);
  }
  delete<T = any>(path: string, body?: unknown, opts?: SendOptions) {
    return this.send<T>("DELETE", path, body, opts);
  }

  /** Sends and asserts a 2xx status, then returns `data`. */
  async must<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts: SendOptions = {},
  ): Promise<T> {
    const result = await this.send<T>(method, path, body, opts);
    expect(
      result.ok,
      `${this.label}: ${method} ${apiPath(path)} returned ${result.status}\n${JSON.stringify(result.body, null, 2)}`,
    ).toBe(true);
    return result.data;
  }

  /**
   * Signs in on `path` (`/auth/login` or `/console/login`) and keeps the
   * access token for the calls that follow.
   */
  async signIn(
    path: "/auth/login" | "/console/login",
    email: string,
    password: string,
    opts: SendOptions = {},
  ): Promise<ApiResult<Tokens>> {
    const result = await this.send<Tokens>(
      "POST",
      path,
      { email, password },
      opts,
    );
    if (result.ok) this.token = result.data.accessToken;
    return result;
  }

  /** The cookie this client holds under `name`, if any. */
  async cookie(name: string): Promise<string | undefined> {
    const { cookies } = await this.context.storageState();
    return cookies.find((cookie) => cookie.name === name)?.value;
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }
}
