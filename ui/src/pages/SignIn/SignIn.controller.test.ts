import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/services/auth.api";
import { useAuthStore } from "~/stores/auth.store";
import { mountController, settle } from "~/tests/mount-controller";
import { admin, apiError, tokensFor } from "~/tests/fixtures";
import { useSignInController } from "./SignIn.controller";

const { replace, route } = vi.hoisted(() => ({
  replace: vi.fn(),
  route: { query: {} as Record<string, unknown> },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ replace }),
  useRoute: () => route,
}));
vi.mock("~/services/auth.api");

beforeEach(() => {
  vi.clearAllMocks();
  route.query = {};
  vi.mocked(authApi.fetchAuthMethods).mockResolvedValue({
    signupEnabled: false,
    password: true,
    emailOtp: true,
    branding: { appName: "Acme", logoUrl: null },
  });
  vi.mocked(authApi.login).mockResolvedValue(tokensFor(admin));
  vi.mocked(authApi.sendCode).mockResolvedValue(null);
  vi.mocked(authApi.confirmSignInCode).mockResolvedValue(tokensFor(admin));
});

async function mount() {
  const { controller } = mountController(useSignInController);
  await settle();
  controller.email.value = "admin@example.com";
  return controller;
}

describe("useSignInController", () => {
  describe("password", () => {
    it("asks for the email and password first", async () => {
      const c = await mount();
      c.email.value = "";
      await c.submitPassword();
      expect(c.fieldErrors.value.email).toBe("Enter your email address.");
      c.email.value = "admin@example.com";
      await c.submitPassword();
      expect(c.fieldErrors.value.password).toBe("Enter your password.");
      expect(authApi.login).not.toHaveBeenCalled();
    });

    it("signs an admin in and goes back to the page they wanted", async () => {
      route.query = { redirect: "/audit?action=user.created" };
      const c = await mount();
      c.password.value = "secret";
      await c.submitPassword();
      expect(authApi.login).toHaveBeenCalledWith("admin@example.com", "secret");
      expect(useAuthStore().admin?.id).toBe(admin.id);
      expect(replace).toHaveBeenCalledWith("/audit?action=user.created");
    });

    it("ignores a redirect to another site", async () => {
      route.query = { redirect: "//evil.example/" };
      const c = await mount();
      c.password.value = "secret";
      await c.submitPassword();
      expect(replace).toHaveBeenCalledWith({ name: "users" });
    });

    it.each([
      ["AUTHENTICATION_INVALID", 401, /email or password is wrong/],
      ["ACCOUNT_DISABLED", 403, /another admin/],
    ])("explains %s", async (code, status, message) => {
      vi.mocked(authApi.login).mockRejectedValue(apiError(status, code));
      const c = await mount();
      c.password.value = "secret";
      await c.submitPassword();
      expect(c.problem.value?.message).toMatch(message);
    });

    it("says how long to wait when rate limited", async () => {
      vi.mocked(authApi.login).mockRejectedValue(
        apiError(429, "RATE_LIMITED", "Too many.", 30),
      );
      const c = await mount();
      c.password.value = "secret";
      await c.submitPassword();
      expect(c.problem.value?.message).toBe(
        "Too many attempts. Try again in 30 seconds.",
      );
    });
  });

  describe("email code", () => {
    it("sends a login code and confirms it", async () => {
      const c = await mount();
      await c.emailMeACode();
      expect(authApi.sendCode).toHaveBeenCalledWith("admin@example.com");
      expect(c.step.value).toBe("code");

      c.code.value = "123456";
      await c.submitCode();
      expect(authApi.confirmSignInCode).toHaveBeenCalledWith(
        "admin@example.com",
        "123456",
      );
      expect(replace).toHaveBeenCalledWith({ name: "users" });
    });

    it("wants all six digits", async () => {
      const c = await mount();
      await c.emailMeACode();
      c.code.value = "123";
      await c.submitCode();
      expect(c.codeError.value).toBe("Enter the 6-digit code.");
      expect(authApi.confirmSignInCode).not.toHaveBeenCalled();
    });

    it("shows how many tries are left and clears the boxes", async () => {
      vi.mocked(authApi.confirmSignInCode).mockRejectedValue(
        apiError(400, "CODE_INVALID", "Wrong code. 2 tries left."),
      );
      const c = await mount();
      await c.emailMeACode();
      c.code.value = "000000";
      await c.submitCode();
      expect(c.codeError.value).toBe("Wrong code. 2 tries left.");
      expect(c.code.value).toBe("");
    });

    it("asks for a new code when this one expired", async () => {
      vi.mocked(authApi.confirmSignInCode).mockRejectedValue(
        apiError(400, "CODE_EXPIRED"),
      );
      const c = await mount();
      await c.emailMeACode();
      c.code.value = "000000";
      await c.submitCode();
      expect(c.codeError.value).toBe("This code has expired. Send a new one.");
    });

    it("hides the option when the server has email codes off", async () => {
      vi.mocked(authApi.fetchAuthMethods).mockResolvedValue({
        signupEnabled: false,
        password: true,
        emailOtp: false,
        branding: { appName: "Acme", logoUrl: null },
      });
      const c = await mount();
      expect(c.emailCodeEnabled.value).toBe(false);
    });
  });
});
