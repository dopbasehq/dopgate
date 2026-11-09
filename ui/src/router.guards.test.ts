import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteLocationNormalized } from "vue-router";
import * as authApi from "~/services/auth.api";
import { useAuthStore } from "~/stores/auth.store";
import { admin, apiError, member, root, tokensFor } from "~/tests/fixtures";
import { guard } from "./router.guards";

vi.mock("~/services/auth.api");

function to(
  name: string,
  {
    fullPath = `/${name}`,
    meta = {},
  }: { fullPath?: string; meta?: object } = {},
): RouteLocationNormalized {
  return {
    name,
    fullPath,
    path: fullPath,
    meta,
    query: {},
    params: {},
    hash: "",
  } as never;
}

const signIn = to("sign-in", { meta: { public: true, guestOnly: true } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.fetchBootstrapStatus).mockResolvedValue({
    initialized: true,
  });
  vi.mocked(authApi.refreshSession).mockRejectedValue(
    apiError(401, "AUTHENTICATION_REQUIRED"),
  );
});

describe("router guard", () => {
  it("sends everything to setup until the server is set up", async () => {
    vi.mocked(authApi.fetchBootstrapStatus).mockResolvedValue({
      initialized: false,
    });
    expect(await guard(to("users"))).toEqual({ name: "setup" });
    expect(await guard(to("setup", { meta: { public: true } }))).toBe(true);
    expect(authApi.fetchBootstrapStatus).toHaveBeenCalledTimes(1);
  });

  it("closes setup once the server is set up", async () => {
    expect(await guard(to("setup", { meta: { public: true } }))).toEqual({
      name: "sign-in",
    });
  });

  it("restores the session from the refresh cookie once", async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue(tokensFor(admin));
    expect(await guard(to("audit"))).toBe(true);
    expect(useAuthStore().user?.id).toBe(admin.id);
    expect(await guard(to("users"))).toBe(true);
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("asks a signed-out visitor to sign in and keeps the address", async () => {
    expect(await guard(to("user", { fullPath: "/users/usr_1" }))).toEqual({
      name: "sign-in",
      query: { redirect: "/users/usr_1" },
    });
    expect(await guard(signIn)).toBe(true);
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("sends a signed-in admin past the sign-in page", async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue(tokensFor(root));
    expect(await guard(signIn)).toEqual({ name: "users" });
  });

  it("keeps members on No access", async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue(tokensFor(member));
    expect(await guard(to("users"))).toEqual({ name: "no-access" });
    expect(await guard(to("no-access"))).toBe(true);
    expect(await guard(signIn)).toEqual({ name: "no-access" });
  });

  it("sends admins away from No access", async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue(tokensFor(admin));
    expect(await guard(to("no-access"))).toEqual({ name: "users" });
  });
});
