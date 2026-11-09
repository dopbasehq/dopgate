import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/services/auth.api";
import { api } from "~/services/api";
import { admin, apiError, root, tokensFor } from "~/tests/fixtures";
import { useAuthStore } from "./auth.store";

vi.mock("~/services/auth.api");

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useAuthStore", () => {
  it("keeps the access token in memory only", async () => {
    vi.mocked(authApi.login).mockResolvedValue(tokensFor(admin));
    const auth = useAuthStore();
    await auth.login(admin.email, "secret");
    expect(auth.accessToken).toBe(`token-${admin.id}`);
    expect(localStorage.length).toBe(0);
  });

  it("feeds its token to the API client and refreshes it on 401", async () => {
    vi.mocked(authApi.login).mockResolvedValue(tokensFor(admin));
    vi.mocked(authApi.refreshSession).mockResolvedValue({
      ...tokensFor(admin),
      accessToken: "fresh",
    });
    const auth = useAuthStore();
    await auth.login(admin.email, "secret");

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { TOKEN_INVALID: "Expired." },
          }),
          {
            status: 401,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, message: "OK", data: 1 }),
          { status: 200 },
        ),
      );
    await expect(api("/auth/me")).resolves.toBe(1);
    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer fresh");
    expect(auth.accessToken).toBe("fresh");
  });

  it("marks the session expired when the refresh fails mid-session", async () => {
    vi.mocked(authApi.login).mockResolvedValue(tokensFor(root));
    vi.mocked(authApi.refreshSession).mockRejectedValue(
      apiError(401, "AUTHENTICATION_REQUIRED"),
    );
    const auth = useAuthStore();
    await auth.login(root.email, "secret");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { TOKEN_INVALID: "Expired." },
        }),
        {
          status: 401,
        },
      ),
    );
    await expect(api("/auth/me")).rejects.toBeTruthy();
    expect(auth.user).toBeNull();
    expect(auth.sessionExpired).toBe(true);
  });

  it("clears everything on sign out, even when the server call fails", async () => {
    vi.mocked(authApi.login).mockResolvedValue(tokensFor(root));
    vi.mocked(authApi.logout).mockRejectedValue(apiError(0, "NETWORK_ERROR"));
    const auth = useAuthStore();
    await auth.login(root.email, "secret");
    await expect(auth.logout()).rejects.toBeTruthy();
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
    expect(auth.sessionExpired).toBe(false);
  });
});
