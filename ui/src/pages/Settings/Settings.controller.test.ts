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
  selfService: {
    agents: false,
    maxAgentsPerUser: 10,
    personalTokens: true,
    maxPersonalTokensPerUser: 10,
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    username: "mailer",
    passwordSet: true,
    security: "starttls",
    fromEmail: "auth@example.com",
    fromName: "Acme",
    source: "database",
    canStorePassword: true,
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

  it("saves the self-service switches and limits as numbers", async () => {
    vi.mocked(adminApi.updateSettings).mockResolvedValue(settings);
    const c = await mount();
    expect(c.drafts.value?.selfService).toEqual({
      agents: false,
      maxAgentsPerUser: "10",
      personalTokens: true,
      maxPersonalTokensPerUser: "10",
    });
    c.drafts.value!.selfService.agents = true;
    c.drafts.value!.selfService.maxAgentsPerUser = "5";
    await c.save("selfService");
    expect(adminApi.updateSettings).toHaveBeenCalledWith({
      selfService: {
        agents: true,
        maxAgentsPerUser: 5,
        personalTokens: true,
        maxPersonalTokensPerUser: 10,
      },
    });
  });

  it("keeps self-service limits between 1 and 1000", async () => {
    const c = await mount();
    c.drafts.value!.selfService.maxAgentsPerUser = "0";
    c.drafts.value!.selfService.maxPersonalTokensPerUser = "5000";
    expect(await c.save("selfService")).toBe(false);
    expect(c.state.selfService.fieldErrors).toEqual({
      maxAgentsPerUser: "Enter a whole number of at least 1.",
      maxPersonalTokensPerUser: "Use 1000 or less.",
    });
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

  describe("SMTP settings", () => {
    it("sends the section without the password when it wasn't typed", async () => {
      vi.mocked(adminApi.updateSettings).mockResolvedValue(settings);
      const c = await mount();
      expect(c.drafts.value!.smtp.password).toBe("");
      c.drafts.value!.smtp.host = " mail.example.com ";
      c.drafts.value!.smtp.fromEmail = "";
      expect(c.dirty.value.smtp).toBe(true);
      await c.save("smtp");
      expect(adminApi.updateSettings).toHaveBeenCalledWith({
        smtp: {
          host: "mail.example.com",
          port: 587,
          security: "starttls",
          username: "mailer",
          fromEmail: null,
          fromName: "Acme",
        },
      });
    });

    it("sends a typed password, or an empty one to remove it", async () => {
      vi.mocked(adminApi.updateSettings).mockResolvedValue(settings);
      const c = await mount();
      c.drafts.value!.smtp.password = "s3cret";
      await c.save("smtp");
      expect(
        vi.mocked(adminApi.updateSettings).mock.calls[0][0].smtp,
      ).toMatchObject({ password: "s3cret" });

      c.drafts.value!.smtp.clearPassword = true;
      await c.save("smtp");
      expect(
        vi.mocked(adminApi.updateSettings).mock.calls[1][0].smtp,
      ).toMatchObject({ password: "" });
    });

    it("moves a default port along with the security", async () => {
      const c = await mount();
      c.drafts.value!.smtp.security = "tls";
      await settle();
      expect(c.drafts.value!.smtp.port).toBe("465");

      c.drafts.value!.smtp.port = "2525";
      c.drafts.value!.smtp.security = "starttls";
      await settle();
      expect(c.drafts.value!.smtp.port).toBe("2525");
    });

    it("refuses a pasted URL, a bad port and a bad sender", async () => {
      const c = await mount();
      Object.assign(c.drafts.value!.smtp, {
        host: "smtp.example.com:587",
        port: "70000",
        fromEmail: "not-an-address",
      });
      expect(await c.save("smtp")).toBe(false);
      expect(Object.keys(c.state.smtp.fieldErrors).sort()).toEqual([
        "fromEmail",
        "host",
        "port",
      ]);
      c.drafts.value!.smtp.host = "https://smtp.example.com";
      await c.save("smtp");
      expect(c.state.smtp.fieldErrors.host).toBe(
        "Enter just the host name, like smtp.example.com.",
      );
      expect(adminApi.updateSettings).not.toHaveBeenCalled();
    });
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
