import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/services/auth.api";
import { useAuthStore } from "~/stores/auth.store";
import { mountController, settle } from "~/tests/mount-controller";
import { admin, apiError, sessionFixture, signInAs } from "~/tests/fixtures";
import { useAccountController } from "./Account.controller";

vi.mock("~/services/auth.api");

const current = sessionFixture({
  id: "ses_me",
  current: true,
  lastUsedAt: "2026-11-01T00:00:00Z",
});
const other = sessionFixture({ id: "ses_phone" });

beforeEach(() => {
  vi.clearAllMocks();
  signInAs(admin);
  vi.mocked(authApi.fetchMySessions).mockResolvedValue([other, current]);
});

async function mount() {
  const { controller } = mountController(useAccountController);
  await settle();
  return controller;
}

describe("useAccountController", () => {
  it("saves the display name to the signed-in account", async () => {
    vi.mocked(authApi.updateMe).mockResolvedValue({
      ...admin,
      displayName: "Ada L",
    });
    const c = await mount();
    expect(c.displayName.value).toBe("Ada");
    c.displayName.value = "Ada L";
    await c.saveProfile();
    expect(authApi.updateMe).toHaveBeenCalledWith({ displayName: "Ada L" });
    expect(useAuthStore().user?.displayName).toBe("Ada L");
    expect(c.profileSaved.value).toBe(true);
  });

  describe("password", () => {
    it("checks the fields first", async () => {
      const c = await mount();
      c.newPassword.value = "new one";
      c.confirmPassword.value = "other";
      await c.submitPassword();
      expect(c.passwordErrors.value).toEqual({
        current: "Enter your current password.",
        confirm: "The passwords don't match.",
      });
      expect(authApi.changePassword).not.toHaveBeenCalled();
    });

    it("changes it and clears the form", async () => {
      vi.mocked(authApi.changePassword).mockResolvedValue(null);
      const c = await mount();
      c.currentPassword.value = "old";
      c.newPassword.value = "new password";
      c.confirmPassword.value = "new password";
      await c.submitPassword();
      expect(authApi.changePassword).toHaveBeenCalledWith(
        "old",
        "new password",
      );
      expect(c.passwordChanged.value).toBe(true);
      expect(c.currentPassword.value).toBe("");
    });

    it("points at the wrong current password", async () => {
      vi.mocked(authApi.changePassword).mockRejectedValue(
        apiError(401, "AUTHENTICATION_INVALID"),
      );
      const c = await mount();
      c.currentPassword.value = "wrong";
      c.newPassword.value = "new password";
      c.confirmPassword.value = "new password";
      await c.submitPassword();
      expect(c.passwordErrors.value.current).toBe(
        "This isn't your current password.",
      );
    });
  });

  describe("email", () => {
    it("sends a code to the new address with the current password, then confirms it", async () => {
      vi.mocked(authApi.changeEmail).mockResolvedValue(null);
      vi.mocked(authApi.confirmEmailChange).mockResolvedValue({
        ...admin,
        email: "ada@new.example",
      });
      const c = await mount();
      expect(c.needsEmailPassword.value).toBe(true);
      c.newEmail.value = "ada@new.example";
      c.emailPassword.value = "secret";
      await c.requestEmailChange();
      expect(authApi.changeEmail).toHaveBeenCalledWith(
        "ada@new.example",
        "secret",
      );
      expect(c.emailStep.value).toBe("code");
      expect(c.emailPassword.value).toBe("");

      c.emailCode.value = "123456";
      await c.confirmEmail();
      expect(authApi.confirmEmailChange).toHaveBeenCalledWith(
        "ada@new.example",
        "123456",
      );
      expect(useAuthStore().user?.email).toBe("ada@new.example");
      expect(c.emailStep.value).toBe("idle");
      expect(c.emailChanged.value).toBe(true);
    });

    it("asks for the current password before calling the server", async () => {
      const c = await mount();
      c.newEmail.value = "ada@new.example";
      await c.requestEmailChange();
      expect(c.emailPasswordError.value).toBe("Enter your current password.");
      expect(authApi.changeEmail).not.toHaveBeenCalled();
    });

    it("puts a wrong current password on the password field", async () => {
      vi.mocked(authApi.changeEmail).mockRejectedValue(
        apiError(
          401,
          "AUTHENTICATION_INVALID",
          "The current password is wrong.",
        ),
      );
      const c = await mount();
      c.newEmail.value = "ada@new.example";
      c.emailPassword.value = "wrong";
      await c.requestEmailChange();
      expect(c.emailPasswordError.value).toBe("The current password is wrong.");
      expect(c.emailFieldError.value).toBeNull();
      expect(c.emailStep.value).toBe("idle");
    });

    it("sends no password for an account without one", async () => {
      signInAs({ ...admin, hasPassword: false });
      vi.mocked(authApi.changeEmail).mockResolvedValue(null);
      const c = await mount();
      expect(c.needsEmailPassword.value).toBe(false);
      c.newEmail.value = "ada@new.example";
      await c.requestEmailChange();
      expect(authApi.changeEmail).toHaveBeenCalledWith(
        "ada@new.example",
        undefined,
      );
      expect(c.emailStep.value).toBe("code");
    });

    it("says when the address is taken", async () => {
      vi.mocked(authApi.changeEmail).mockRejectedValue(
        apiError(409, "EMAIL_TAKEN"),
      );
      const c = await mount();
      c.newEmail.value = "taken@example.com";
      c.emailPassword.value = "secret";
      await c.requestEmailChange();
      expect(c.emailFieldError.value).toBe(
        "Another account already uses this email.",
      );
      expect(c.emailStep.value).toBe("idle");
    });

    it("won't change to the same address", async () => {
      const c = await mount();
      c.newEmail.value = admin.email.toUpperCase();
      await c.requestEmailChange();
      expect(c.emailFieldError.value).toBe(
        "This is already your email address.",
      );
    });

    it("shows a wrong code and clears the boxes", async () => {
      vi.mocked(authApi.changeEmail).mockResolvedValue(null);
      vi.mocked(authApi.confirmEmailChange).mockRejectedValue(
        apiError(400, "CODE_INVALID", "Wrong code. 4 tries left."),
      );
      const c = await mount();
      c.newEmail.value = "ada@new.example";
      c.emailPassword.value = "secret";
      await c.requestEmailChange();
      c.emailCode.value = "000000";
      await c.confirmEmail();
      expect(c.emailCodeError.value).toBe("Wrong code. 4 tries left.");
      expect(c.emailCode.value).toBe("");
    });
  });

  describe("sessions", () => {
    it("lists this browser first", async () => {
      const c = await mount();
      expect(c.sessions.value?.map((s) => s.id)).toEqual([
        "ses_me",
        "ses_phone",
      ]);
      expect(c.hasOtherSessions.value).toBe(true);
    });

    it("signs out one session", async () => {
      vi.mocked(authApi.revokeMySession).mockResolvedValue(null);
      const c = await mount();
      vi.mocked(authApi.fetchMySessions).mockResolvedValue([current]);
      await c.revoke("ses_phone");
      expect(authApi.revokeMySession).toHaveBeenCalledWith("ses_phone");
      expect(c.sessions.value).toHaveLength(1);
    });

    it("signs out every other session", async () => {
      vi.mocked(authApi.revokeOtherSessions).mockResolvedValue(null);
      const c = await mount();
      vi.mocked(authApi.fetchMySessions).mockResolvedValue([current]);
      await c.revokeOthers();
      expect(authApi.revokeOtherSessions).toHaveBeenCalled();
      expect(c.hasOtherSessions.value).toBe(false);
    });
  });
});
