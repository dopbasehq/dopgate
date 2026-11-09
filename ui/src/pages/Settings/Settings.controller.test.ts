import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "~/services/admin.api";
import type { Settings } from "~/services/types";
import { mountController, settle } from "~/tests/mount-controller";
import { apiError, signInAs } from "~/tests/fixtures";
import { useSettingsController } from "./Settings.controller";

vi.mock("~/services/admin.api");

const settings: Settings = {
  signup: {
    enabled: true,
    requireEmailVerification: true,
    passwordlessSignup: false,
  },
  password: { minLength: 10 },
  tokens: {
    accessTokenMinutes: 15,
    refreshTokenIdleDays: 30,
    sessionAbsoluteDays: 90,
  },
  limits: {
    codeMinutes: 10,
    codeMaxAttempts: 5,
    codeResendSeconds: 60,
    codesPerHour: 5,
    lockoutAttempts: 10,
    lockoutMinutes: 15,
    ipRequestsPerMinute: 60,
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    username: "mailer",
    passwordSet: true,
    security: "starttls",
    fromEmail: "auth@example.com",
    fromName: "Acme",
    source: "server_config",
  },
  branding: { appName: "Acme", logoUrl: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  signInAs();
  vi.mocked(adminApi.fetchSettings).mockResolvedValue(settings);
  vi.mocked(adminApi.listAuditEvents).mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

async function mount() {
  const { controller } = mountController(useSettingsController);
  await settle();
  return controller;
}

describe("useSettingsController", () => {
  it("fills every section from the server", async () => {
    const c = await mount();
    expect(c.drafts.value?.signup.enabled).toBe(true);
    expect(c.drafts.value?.password.minLength).toBe("10");
    expect(c.drafts.value?.branding).toEqual({ appName: "Acme", logoUrl: "" });
    expect(Object.values(c.dirty.value).some(Boolean)).toBe(false);
  });

  it("saves one section with the whole sub-object", async () => {
    vi.mocked(adminApi.updateSettings).mockResolvedValue({
      ...settings,
      limits: { ...settings.limits, lockoutMinutes: 30 },
    });
    const c = await mount();
    c.drafts.value!.limits.lockoutMinutes = "30";
    c.drafts.value!.signup.enabled = false;
    expect(c.dirty.value.limits).toBe(true);
    await c.save("limits");
    expect(adminApi.updateSettings).toHaveBeenCalledWith({
      limits: { ...settings.limits, lockoutMinutes: 30 },
    });
    expect(c.dirty.value.limits).toBe(false);
    expect(c.state.limits.saved).toBe(true);
    // The other section keeps its unsaved edit.
    expect(c.drafts.value!.signup.enabled).toBe(false);
    expect(c.dirty.value.signup).toBe(true);
  });

  it("wants whole numbers of at least 1", async () => {
    const c = await mount();
    c.drafts.value!.tokens.accessTokenMinutes = "1.5";
    c.drafts.value!.tokens.refreshTokenIdleDays = "0";
    expect(await c.save("tokens")).toBe(false);
    expect(Object.keys(c.state.tokens.fieldErrors)).toEqual([
      "accessTokenMinutes",
      "refreshTokenIdleDays",
    ]);
    expect(adminApi.updateSettings).not.toHaveBeenCalled();
  });

  it("checks branding and sends an empty logo as null", async () => {
    vi.mocked(adminApi.updateSettings).mockResolvedValue(settings);
    const c = await mount();
    c.drafts.value!.branding.logoUrl = "ftp://logo";
    await c.save("branding");
    expect(c.state.branding.fieldErrors.logoUrl).toBeTruthy();

    c.drafts.value!.branding = { appName: " Acme Inc ", logoUrl: " " };
    await c.save("branding");
    expect(adminApi.updateSettings).toHaveBeenCalledWith({
      branding: { appName: "Acme Inc", logoUrl: null },
    });
  });

  it("shows the server's reason when it refuses", async () => {
    vi.mocked(adminApi.updateSettings).mockRejectedValue(
      apiError(422, "SETTINGS_INVALID", "Minimum length must be at least 8."),
    );
    const c = await mount();
    c.drafts.value!.password.minLength = "4";
    await c.save("password");
    expect(c.state.password.error).toBe("Minimum length must be at least 8.");
  });

  it("puts a section back with Discard", async () => {
    const c = await mount();
    c.drafts.value!.password.minLength = "20";
    c.discard("password");
    expect(c.drafts.value!.password.minLength).toBe("10");
  });

  describe("SMTP test", () => {
    it("sends to your own address by default", async () => {
      vi.mocked(adminApi.sendSmtpTest).mockResolvedValue(null);
      const c = await mount();
      await c.sendTest();
      expect(adminApi.sendSmtpTest).toHaveBeenCalledWith(undefined);
      expect(c.testResult.value).toEqual({
        ok: true,
        message: "Test email sent to your address.",
      });
    });

    it("reports a delivery failure", async () => {
      vi.mocked(adminApi.sendSmtpTest).mockRejectedValue(
        apiError(
          502,
          "SMTP_SEND_FAILED",
          "Connection refused by smtp.example.com.",
        ),
      );
      const c = await mount();
      c.testTo.value = "ops@example.com";
      await c.sendTest();
      expect(adminApi.sendSmtpTest).toHaveBeenCalledWith("ops@example.com");
      expect(c.testResult.value).toEqual({
        ok: false,
        message: "Connection refused by smtp.example.com.",
      });
    });
  });
});
