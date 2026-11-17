import { PASSWORD, about, expect, step, test, useServer } from "../harness/index.ts";
import { eventsOf } from "./admin.support.ts";

// DOPGATE_SMTP_* names a fake SMTP server, which locks SMTP to it.
const app = useServer({ smtp: "env" });

test(
  "SMTP set by the server is shown as server_config and can't be changed through the API",
  {
    tag: ["@settings", "@security"],
    annotation: about(
      "When DOPGATE_SMTP_HOST is set, GET /admin/settings reports source server_config with the host from the environment, and PATCHing the smtp section answers SETTINGS_INVALID. Other sections still save.",
    ),
  },
  async () => {
    await step("GET /admin/settings shows the server's SMTP", async () => {
      const settings = await app.service.get("/admin/settings");
      expect(settings.data.smtp).toMatchObject({
        host: "127.0.0.1",
        port: app.server.smtp!.port,
        security: "none",
        fromEmail: "no-reply@dopbase.com",
        passwordSet: false,
        source: "server_config",
      });
    });
    await step("PATCH smtp is 422 SETTINGS_INVALID", async () => {
      const refused = await app.service.patch("/admin/settings", {
        smtp: { host: "other.example.com" },
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("SETTINGS_INVALID");
    });
    await step("A request with smtp and another section saves neither", async () => {
      const refused = await app.service.patch("/admin/settings", {
        smtp: { host: "other.example.com" },
        branding: { appName: "Not Saved" },
      });
      expect(refused.code).toBe("SETTINGS_INVALID");
      const settings = await app.service.get("/admin/settings");
      expect(settings.data.branding.appName).toBe("Dopgate");
    });
    await step("The host is unchanged and other sections still save", async () => {
      const saved = await app.service.patch("/admin/settings", {
        branding: { appName: "Env Mail" },
      });
      expect(saved.status).toBe(200);
      expect(saved.data.smtp.host).toBe("127.0.0.1");
      expect(saved.data.smtp.source).toBe("server_config");
      await app.settings("branding", { appName: "Dopgate" });
    });
  },
);

test(
  "with SMTP set by the server, real mail and the SMTP test go to that server",
  {
    tag: ["@settings", "@templates"],
    annotation: about(
      "A sign-up code arrives at the SMTP server named in the environment. The SMTP test reaches it too, for the caller and for a given address, and the log gets no copy.",
    ),
  },
  async () => {
    const root = await app.root();
    const email = app.email("env");
    await step("POST /auth/signup sends the code over SMTP", async () => {
      const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
      expect(signedUp.status).toBe(201);
      const mail = await app.mail.last(email);
      expect(mail.subject).toMatch(/^Your Dopgate code is \d{6}$/);
      expect(mail.raw).toContain("no-reply@dopbase.com");
      expect(await app.mail.code(email)).toMatch(/^\d{6}$/);
    });
    await step("The server log has no copy of it", async () => {
      const log = await app.server.log();
      expect(log).not.toContain(`to=${email}`);
    });
    await step("POST /admin/settings/smtp/test as root reaches the server", async () => {
      const sent = await root.api.post("/admin/settings/smtp/test");
      expect(sent.status).toBe(200);
      expect(sent.message).toBe("SMTP_TEST_SENT");
      const mail = await app.mail.last(root.email);
      expect(mail.subject).toBe("Test message from Dopgate");
    });
    await step("The service key sends one to a given address", async () => {
      const to = app.email("given");
      const sent = await app.service.post("/admin/settings/smtp/test", { to });
      expect(sent.status).toBe(200);
      expect((await app.mail.last(to)).subject).toBe("Test message from Dopgate");
    });
    await step("The service key without an address is EMAIL_INVALID", async () => {
      const refused = await app.service.post("/admin/settings/smtp/test");
      expect(refused.code).toBe("EMAIL_INVALID");
    });
    await step("The server's SMTP can refuse the recipient, which is a 502", async () => {
      app.server.smtp!.refuseRecipients("550 no");
      try {
        const refused = await root.api.post("/admin/settings/smtp/test", { to: app.email("nope") });
        expect(refused.status).toBe(502);
        expect(refused.code).toBe("SMTP_SEND_FAILED");
      } finally {
        app.server.smtp!.refuseRecipients(undefined);
      }
    });
  },
);

test(
  "the email template test goes through the server's SMTP",
  {
    tag: ["@settings", "@templates"],
    annotation: about(
      "POST /admin/email-templates/{name}/test sends the rendered draft to the signed-in admin over the SMTP server named in the environment.",
    ),
  },
  async () => {
    const root = await app.root();
    await step("POST /admin/email-templates/login_code/test as root", async () => {
      const sent = await root.api.post("/admin/email-templates/login_code/test", {
        subject: "Env test {{code}}",
        html: "<p>{{code}}</p>",
        text: "Code {{code}}",
      });
      expect(sent.status).toBe(200);
      expect(sent.message).toBe("EMAIL_TEMPLATE_TEST_SENT");
    });
    await step("The SMTP server received the rendered message", async () => {
      const mails = await app.mail.to(root.email);
      const mail = mails.find((m) => m.subject === "Env test 482913");
      expect(mail).toBeDefined();
      expect(mail!.text).toContain("Code 482913");
    });
  },
);

test(
  "a settings change on a server with SMTP in the environment still reaches the audit log",
  {
    tag: ["@settings", "@audit"],
    annotation: about(
      "Saving a section other than smtp records settings.updated, and the refused smtp change doesn't.",
    ),
  },
  async () => {
    const before = (await eventsOf(app.service, "settings.updated")).length;
    await step("A refused smtp PATCH records nothing", async () => {
      await app.service.patch("/admin/settings", { smtp: { host: "x.example.com" } });
      expect((await eventsOf(app.service, "settings.updated")).length).toBe(before);
    });
    await step("A saved branding PATCH records settings.updated", async () => {
      await app.service.patch("/admin/settings", { branding: { appName: "Dopgate" } });
      const events = await eventsOf(app.service, "settings.updated");
      expect(events.length).toBe(before + 1);
      expect(events[0].metadata.sections).toEqual(["branding"]);
    });
  },
);
