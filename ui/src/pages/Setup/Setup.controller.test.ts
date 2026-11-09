import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/services/auth.api";
import { useAuthStore } from "~/stores/auth.store";
import { mountController } from "~/tests/mount-controller";
import { apiError, root, tokensFor } from "~/tests/fixtures";
import { useSetupController } from "./Setup.controller";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("~/services/auth.api");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.createRoot).mockResolvedValue({
    userId: root.id,
    email: root.email,
  });
  vi.mocked(authApi.login).mockResolvedValue(tokensFor(root));
});

function fill(c: ReturnType<typeof useSetupController>, overrides = {}) {
  const values = {
    setupToken: " tok_123 ",
    email: "root@example.com",
    password: "correct horse",
    confirm: "correct horse",
    ...overrides,
  };
  c.setupToken.value = values.setupToken;
  c.email.value = values.email;
  c.password.value = values.password;
  c.confirm.value = values.confirm;
}

describe("useSetupController", () => {
  it("checks the form before calling the server", async () => {
    const { controller: c } = mountController(useSetupController);
    fill(c, { setupToken: "", email: "nope", confirm: "different" });
    await c.submit();
    expect(c.fieldErrors.value).toEqual({
      setupToken: "Enter the setup token from the server log.",
      email: "Enter a valid email address.",
      confirm: "The passwords don't match.",
    });
    expect(authApi.createRoot).not.toHaveBeenCalled();
  });

  it("creates root, signs in and opens the console", async () => {
    const { controller: c } = mountController(useSetupController);
    fill(c);
    await c.submit();
    expect(authApi.createRoot).toHaveBeenCalledWith({
      setupToken: "tok_123",
      email: "root@example.com",
      password: "correct horse",
    });
    expect(authApi.login).toHaveBeenCalledWith(
      "root@example.com",
      "correct horse",
    );
    const auth = useAuthStore();
    expect(auth.initialized).toBe(true);
    expect(auth.user?.id).toBe(root.id);
    expect(auth.accessToken).toBe(`token-${root.id}`);
    expect(replace).toHaveBeenCalledWith({ name: "users" });
  });

  it("points at the setup token when the server rejects it", async () => {
    vi.mocked(authApi.createRoot).mockRejectedValue(
      apiError(401, "SETUP_TOKEN_INVALID"),
    );
    const { controller: c } = mountController(useSetupController);
    fill(c);
    await c.submit();
    expect(c.fieldErrors.value.setupToken).toMatch(/wrong or has expired/);
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the server's password rule", async () => {
    vi.mocked(authApi.createRoot).mockRejectedValue(
      apiError(422, "PASSWORD_INVALID", "Use at least 12 characters."),
    );
    const { controller: c } = mountController(useSetupController);
    fill(c);
    await c.submit();
    expect(c.fieldErrors.value.password).toBe("Use at least 12 characters.");
  });

  it("says so when someone else already set the server up", async () => {
    vi.mocked(authApi.createRoot).mockRejectedValue(
      apiError(409, "ALREADY_INITIALIZED"),
    );
    const { controller: c } = mountController(useSetupController);
    fill(c);
    await c.submit();
    expect(c.alreadySetUp.value).toBe(true);
    expect(useAuthStore().initialized).toBe(true);
  });

  it("sends you to sign in when root exists but signing in failed", async () => {
    vi.mocked(authApi.login).mockRejectedValue(apiError(429, "RATE_LIMITED"));
    const { controller: c } = mountController(useSetupController);
    fill(c);
    await c.submit();
    expect(replace).toHaveBeenCalledWith({ name: "sign-in" });
  });
});
