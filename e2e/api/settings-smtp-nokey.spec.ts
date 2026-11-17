import { PASSWORD, about, expect, step, test, useServer } from "../harness/index.ts";

// No service key: a saved SMTP password can't be encrypted, so it can't be saved.
const app = useServer({ serviceKey: false, relaxLimits: false });

test(
  "without a service key an SMTP password can't be saved",
  {
    tag: ["@settings", "@security"],
    annotation: about(
      "canStorePassword is false while DOPGATE_SERVICE_KEY is unset. Saving a password answers SETTINGS_INVALID, and the same SMTP settings without a password save.",
    ),
  },
  async () => {
    const root = await app.root();
    await step("GET /admin/settings as root says passwords can't be stored", async () => {
      const settings = await root.api.get("/admin/settings");
      expect(settings.status).toBe(200);
      expect(settings.data.smtp.canStorePassword).toBe(false);
      expect(settings.data.smtp.source).toBe("log");
    });
    await step("PATCH smtp with a password is 422 SETTINGS_INVALID", async () => {
      const refused = await root.api.patch("/admin/settings", {
        smtp: { host: "mail.example.com", username: "u", password: "hunter22hunter22" },
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("SETTINGS_INVALID");
    });
    await step("Nothing was saved", async () => {
      const settings = await root.api.get("/admin/settings");
      expect(settings.data.smtp).toMatchObject({ host: null, passwordSet: false, source: "log" });
    });
    await step("The same host without a password saves", async () => {
      const saved = await root.api.patch("/admin/settings", {
        smtp: { host: "mail.example.com", username: "u", security: "starttls" },
      });
      expect(saved.status).toBe(200);
      expect(saved.data.smtp).toMatchObject({
        host: "mail.example.com",
        source: "database",
        passwordSet: false,
        canStorePassword: false,
      });
    });
    await step("An empty password string is accepted, since it only removes one", async () => {
      const saved = await root.api.patch("/admin/settings", {
        smtp: { host: "mail.example.com", password: "" },
      });
      expect(saved.status).toBe(200);
    });
    await step("Turning SMTP off puts the log back", async () => {
      const saved = await root.api.patch("/admin/settings", { smtp: { host: "" } });
      expect(saved.data.smtp.source).toBe("log");
    });
  },
);

test(
  "the SMTP test on a server with no service key and no saved SMTP",
  {
    tag: "@settings",
    annotation: about(
      "With no SMTP saved, root's SMTP test is SMTP_NOT_CONFIGURED, and a call carrying a made-up key is rejected.",
    ),
  },
  async () => {
    const root = await app.root();
    await step("POST /admin/settings/smtp/test as root is SMTP_NOT_CONFIGURED", async () => {
      const refused = await root.api.post("/admin/settings/smtp/test");
      expect(refused.code).toBe("SMTP_NOT_CONFIGURED");
    });
    await step("A made-up service key is refused", async () => {
      const refused = await app.api.post(
        "/admin/settings/smtp/test",
        { to: app.email("any") },
        { token: "e2e_not_a_key_".padEnd(48, "x") },
      );
      expect(refused.status).toBe(401);
    });
    await step("Mail still goes to the log", async () => {
      const email = app.email("logged");
      const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
      expect(signedUp.status).toBe(201);
      expect((await app.mail.last(email)).subject).toMatch(/^Your Dopgate code/);
    });
  },
);
