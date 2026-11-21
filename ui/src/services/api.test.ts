import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, errorMessage, registerAuth } from "./api";

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, message: "OK", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(
  status: number,
  code: string,
  message = "Nope.",
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ success: false, error: { [code]: message } }),
    {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    },
  );
}

const fetchMock = vi.fn<typeof fetch>();
let token: string | null;
const refresh = vi.fn<() => Promise<boolean>>();
const signedOut = vi.fn();

function authHeader(call: number): string | undefined {
  const init = fetchMock.mock.calls[call]?.[1];
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  signedOut.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  token = "old";
  registerAuth({ token: () => token, refresh, signedOut });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("returns the envelope's data and sends the Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(envelope({ id: "usr_1" }));
    await expect(api("/auth/me")).resolves.toEqual({ id: "usr_1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/auth/me");
    expect(authHeader(0)).toBe("Bearer old");
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("drops empty query values and sends the cookie header when asked", async () => {
    fetchMock.mockResolvedValueOnce(envelope(null));
    await api("/admin/users", {
      query: {
        search: "",
        role: null,
        status: undefined,
        limit: 50,
        cursor: "c 1",
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/admin/users?limit=50&cursor=c+1",
    );

    fetchMock.mockResolvedValueOnce(envelope(null));
    await api("/auth/refresh", {
      method: "POST",
      body: {},
      auth: false,
      cookie: true,
    });
    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["X-Dopgate-Session"]).toBe("cookie");
    expect(headers.Authorization).toBeUndefined();
  });

  it("resolves null for 204 No Content", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      api("/admin/users/usr_1", { method: "DELETE" }),
    ).resolves.toBeNull();
  });

  it("turns the error envelope into an ApiError with status, code and message", async () => {
    fetchMock.mockResolvedValueOnce(
      failure(409, "EMAIL_TAKEN", "That email is taken."),
    );
    const error = await api("/admin/users", { method: "POST", body: {} }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "EMAIL_TAKEN",
      message: "That email is taken.",
    });
  });

  it("reads Retry-After on 429", async () => {
    fetchMock.mockResolvedValueOnce(
      failure(429, "RATE_LIMITED", "Slow down.", { "Retry-After": "42" }),
    );
    const error = (await api("/auth/login", { auth: false }).catch(
      (e) => e,
    )) as ApiError;
    expect(error.retryAfter).toBe(42);
    expect(errorMessage(error, "x")).toBe(
      "Too many attempts. Try again in 42 seconds.",
    );
  });

  it("reports a network failure as status 0", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = (await api("/auth/me").catch((e) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
  });

  describe("refresh and retry", () => {
    it.each(["TOKEN_INVALID", "AUTHENTICATION_REQUIRED"])(
      "refreshes once on 401 %s and retries with the new token",
      async (code) => {
        fetchMock
          .mockResolvedValueOnce(failure(401, code))
          .mockResolvedValueOnce(envelope({ ok: true }));
        refresh.mockImplementation(async () => {
          token = "new";
          return true;
        });

        await expect(api("/auth/me")).resolves.toEqual({ ok: true });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(authHeader(0)).toBe("Bearer old");
        expect(authHeader(1)).toBe("Bearer new");
        expect(signedOut).not.toHaveBeenCalled();
      },
    );

    it("shares one refresh between calls that fail together", async () => {
      fetchMock.mockImplementation(async (_url, init) => {
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === "Bearer new"
          ? envelope("ok")
          : failure(401, "TOKEN_INVALID");
      });
      let finish!: (ok: boolean) => void;
      refresh.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finish = (ok) => {
              token = "new";
              resolve(ok);
            };
          }),
      );

      const calls = Promise.all([api("/a"), api("/b"), api("/c")]);
      await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve));
      finish(true);
      await expect(calls).resolves.toEqual(["ok", "ok", "ok"]);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("signs out and throws the original error when the refresh fails", async () => {
      fetchMock.mockResolvedValueOnce(
        failure(401, "TOKEN_INVALID", "Token expired."),
      );
      refresh.mockResolvedValue(false);
      const error = (await api("/auth/me").catch((e) => e)) as ApiError;
      expect(error.code).toBe("TOKEN_INVALID");
      expect(signedOut).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries only once, then signs out", async () => {
      fetchMock.mockResolvedValue(failure(401, "TOKEN_INVALID"));
      refresh.mockResolvedValue(true);
      await expect(api("/auth/me")).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(signedOut).toHaveBeenCalledTimes(1);
    });

    it("leaves other 401s alone", async () => {
      fetchMock.mockResolvedValueOnce(failure(401, "AUTHENTICATION_INVALID"));
      await expect(
        api("/auth/password/change", { method: "POST" }),
      ).rejects.toMatchObject({
        code: "AUTHENTICATION_INVALID",
      });
      expect(refresh).not.toHaveBeenCalled();
      expect(signedOut).not.toHaveBeenCalled();
    });

    it("never refreshes for anonymous calls", async () => {
      fetchMock.mockResolvedValueOnce(failure(401, "AUTHENTICATION_REQUIRED"));
      await expect(
        api("/auth/refresh", { method: "POST", auth: false }),
      ).rejects.toMatchObject({
        status: 401,
      });
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
