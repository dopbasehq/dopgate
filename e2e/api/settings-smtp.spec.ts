import { codeIn } from "../harness/mail.ts";
import { startSmtp, type SmtpSink } from "../harness/smtp.ts";
import { ROOT_EMAIL, PASSWORD, about, expect, step, test, useServer } from "../harness/index.ts";
import { eventsOf } from "./admin.support.ts";

const app = useServer();

let smtp: SmtpSink | undefined;
async function sink(): Promise<SmtpSink> {
  smtp ??= await startSmtp();
  return smtp;
}
test.afterAll(async () => {
  await smtp?.stop();
});

/** The settings that point mail at the fake SMTP server. */
async function pointAtSink(extra: Record<string, unknown> = {}) {
  const server = await sink();
  return app.service.patch("/admin/settings", {
    smtp: {
      host: "127.0.0.1",
      port: server.port,
      security: "none",
      fromEmail: "mailer@dopbase.com",
      fromName: "Dopgate Test",
      ...extra,
    },
  });
}

async function mailTo(email: string, after = 0) {
  const server = await sink();
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = server.messages.filter((mail) => mail.to === email);
    if (found.length > after) return found[found.length - 1]!;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`No message reached the SMTP server for ${email}`);
}

test(
  "with no SMTP saved, mail goes to the log and the SMTP test says it isn't configured",
  {
    tag: ["@settings", "@templates"],
    annotation: about(
      "A fresh server has smtp.source log. POST /admin/settings/smtp/test answers 400 SMTP_NOT_CONFIGURED, and the service key must also give a recipient.",
    ),
  },
  async () => {
    const root = await app.root();
    await step("GET /admin/settings shows source log with no host", async () => {
      const settings = await app.service.get("/admin/settings");
      expect(settings.data.smtp).toMatchObject({
        host: null,
        source: "log",
        passwordSet: false,
        security: "starttls",
        port: 587,
        fromEmail: "no-reply@dopgate.com",
        canStorePassword: true,
      });
    });
    await step("POST /admin/settings/smtp/test as root is SMTP_NOT_CONFIGURED", async () => {
      const refused = await root.api.post("/admin/settings/smtp/test");
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("SMTP_NOT_CONFIGURED");
    });
    await step("With a recipient, the service key gets the same answer", async () => {
      const refused = await app.service.post("/admin/settings/smtp/test", { to: app.email("any") });
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("SMTP_NOT_CONFIGURED");
    });
    await step("The service key without a recipient is 422 EMAIL_INVALID", async () => {
      const refused = await app.service.post("/admin/settings/smtp/test");
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("EMAIL_INVALID");
    });
    await step("A recipient that isn't an email is 422 EMAIL_INVALID", async () => {
      const refused = await root.api.post("/admin/settings/smtp/test", { to: "not-an-email" });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("EMAIL_INVALID");
    });
    await step("A sign-up email is written to the server log", async () => {
      const email = app.email("logged");
      await app.api.post("/auth/signup", { email, password: PASSWORD });
      const mail = await app.mail.last(email);
      expect(mail.subject).toMatch(/^Your Dopgate code is \d{6}$/);
    });
  },
);

test(
  "SMTP settings with a bad value are refused with SETTINGS_INVALID",
  {
    tag: "@settings",
    annotation: about(
      "A host with a scheme or port, a port of 0, an invalid sender address, a name over one line and a password over 1024 characters are all 422 SETTINGS_INVALID, and nothing is saved.",
    ),
  },
  async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["a host with https://", { host: "https://mail.example.com" }],
      ["a host with a port", { host: "mail.example.com:587" }],
      ["a host with spaces", { host: "mail example" }],
      ["port 0", { host: "mail.example.com", port: 0 }],
      ["a sender that isn't an email", { host: "mail.example.com", fromEmail: "nobody" }],
      ["a multi-line sender name", { host: "mail.example.com", fromName: "A\nB" }],
      ["a multi-line username", { host: "mail.example.com", username: "u\nv" }],
      ["a password over 1024 characters", { host: "mail.example.com", password: "p".repeat(1025) }],
    ];
    for (const [label, smtp] of attempts) {
      await step(`PATCH smtp with ${label}`, async () => {
        const refused = await app.service.patch("/admin/settings", { smtp });
        expect(refused.status, label).toBe(422);
        expect(refused.code, label).toBe("SETTINGS_INVALID");
      });
    }
    await step("An unknown security value is REQUEST_INVALID", async () => {
      const refused = await app.service.patch("/admin/settings", {
        smtp: { host: "mail.example.com", security: "carrier-pigeon" },
      });
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("The settings still say source log", async () => {
      const settings = await app.service.get("/admin/settings");
      expect(settings.data.smtp.source).toBe("log");
      expect(settings.data.smtp.host).toBeNull();
    });
  },
);

test(
  "saving an SMTP host sends real mail to it, and clearing the host goes back to the log",
  {
    tag: ["@settings", "@templates"],
    annotation: about(
      "Pointing the smtp section at a fake SMTP server makes source database. A sign-up code then arrives there as a real message from the saved sender. An empty host returns to source log.",
    ),
  },
  async () => {
    const server = await sink();
    await step("PATCH smtp at the fake server", async () => {
      const saved = await pointAtSink();
      expect(saved.status).toBe(200);
      expect(saved.data.smtp).toMatchObject({
        host: "127.0.0.1",
        port: server.port,
        security: "none",
        username: null,
        passwordSet: false,
        fromEmail: "mailer@dopbase.com",
        fromName: "Dopgate Test",
        source: "database",
      });
    });
    const email = app.email("smtp");
    await step("POST /auth/signup sends the code over SMTP", async () => {
      const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
      expect(signedUp.status).toBe(201);
      const mail = await mailTo(email);
      expect(mail.subject).toMatch(/^Your Dopgate code is \d{6}$/);
      expect(codeIn(mail)).toMatch(/^\d{6}$/);
      expect(mail.raw).toContain("mailer@dopbase.com");
      expect(mail.raw).toContain("Dopgate Test");
    });
    await step("Nothing was written to the log for it", async () => {
      expect(await app.mail.count(email)).toBe(0);
    });
    await step("An empty host turns SMTP off again", async () => {
      const saved = await app.service.patch("/admin/settings", { smtp: { host: "" } });
      expect(saved.data.smtp).toMatchObject({ host: null, source: "log" });
      const logged = app.email("backtolog");
      await app.api.post("/auth/signup", { email: logged, password: PASSWORD });
      expect((await app.mail.last(logged)).subject).toMatch(/^Your Dopgate code/);
      expect(server.messages.some((mail) => mail.to === logged)).toBe(false);
    });
    await step("The smtp section is replaced whole: a port left out takes the usual one", async () => {
      const saved = await app.service.patch("/admin/settings", {
        smtp: { host: "mail.example.com", security: "tls" },
      });
      expect(saved.data.smtp).toMatchObject({ port: 465, security: "tls" });
      const plain = await app.service.patch("/admin/settings", {
        smtp: { host: "mail.example.com", security: "none" },
      });
      expect(plain.data.smtp.port).toBe(25);
      await app.service.patch("/admin/settings", { smtp: { host: "" } });
    });
  },
);

test(
  "the SMTP test sends a message to the caller or to a given address",
  {
    tag: "@settings",
    annotation: about(
      "With SMTP saved, the test message goes to the signed-in admin by default and to `to` when given. The service key has no address, so it has to give one.",
    ),
  },
  async () => {
    const root = await app.root();
    await pointAtSink();
    try {
      await step("POST /admin/settings/smtp/test as root with no body", async () => {
        const sent = await root.api.post("/admin/settings/smtp/test");
        expect(sent.status).toBe(200);
        expect(sent.message).toBe("SMTP_TEST_SENT");
        const mail = await mailTo(ROOT_EMAIL);
        expect(mail.subject).toBe("Test message from Dopgate");
        expect(mail.text).toContain("your SMTP settings work");
      });
      await step("With `to`, it goes there instead", async () => {
        const to = app.email("elsewhere");
        const sent = await root.api.post("/admin/settings/smtp/test", { to: to.toUpperCase() });
        expect(sent.status).toBe(200);
        expect((await mailTo(to)).subject).toBe("Test message from Dopgate");
      });
      await step("The service key with `to` sends it", async () => {
        const to = app.email("backend");
        const sent = await app.service.post("/admin/settings/smtp/test", { to });
        expect(sent.status).toBe(200);
        expect(sent.message).toBe("SMTP_TEST_SENT");
        await mailTo(to);
      });
      await step("The service key without `to` is EMAIL_INVALID", async () => {
        const refused = await app.service.post("/admin/settings/smtp/test");
        expect(refused.status).toBe(422);
        expect(refused.code).toBe("EMAIL_INVALID");
      });
      await step("The subject uses the branding app name", async () => {
        await app.settings("branding", { appName: "Acme Mail" });
        const to = app.email("branded");
        await root.api.post("/admin/settings/smtp/test", { to });
        expect((await mailTo(to)).subject).toBe("Test message from Acme Mail");
        await app.settings("branding", { appName: "Dopgate" });
      });
    } finally {
      await app.service.patch("/admin/settings", { smtp: { host: "" } });
    }
  },
);

test(
  "the SMTP password is stored, never returned, kept when left out and removed by an empty string",
  {
    tag: ["@settings", "@security"],
    annotation: about(
      "Saving a password flips passwordSet to true. No response ever contains it, a PATCH without a password keeps it, and an empty string removes it. The server authenticates to SMTP with the username it was given.",
    ),
  },
  async () => {
    const secret = app.value();
    const server = await sink();
    try {
      await step("PATCH smtp with a username and a password", async () => {
        const saved = await pointAtSink({ username: "mailer", password: secret });
        expect(saved.status).toBe(200);
        expect(saved.data.smtp).toMatchObject({ username: "mailer", passwordSet: true });
        expect(JSON.stringify(saved.body)).not.toContain(secret);
      });
      await step("GET /admin/settings doesn't show it", async () => {
        const settings = await app.service.get("/admin/settings");
        expect(settings.data.smtp.passwordSet).toBe(true);
        expect(JSON.stringify(settings.body)).not.toContain(secret);
      });
      await step("The SMTP test logs in with the saved credentials", async () => {
        const before = server.auth.length;
        const to = app.email("authed");
        const sent = await app.service.post("/admin/settings/smtp/test", { to });
        expect(sent.status).toBe(200);
        await mailTo(to);
        expect(server.auth.length).toBeGreaterThan(before);
      });
      await step("A PATCH that leaves the password out keeps it", async () => {
        const kept = await pointAtSink({ username: "mailer", fromName: "Renamed" });
        expect(kept.data.smtp.passwordSet).toBe(true);
        expect(kept.data.smtp.fromName).toBe("Renamed");
      });
      await step("An empty password removes it", async () => {
        const removed = await pointAtSink({ username: "mailer", password: "" });
        expect(removed.data.smtp.passwordSet).toBe(false);
        const again = await pointAtSink({ username: "mailer" });
        expect(again.data.smtp.passwordSet).toBe(false);
      });
      await step("The audit log records the change without the password", async () => {
        const events = await eventsOf(app.service, "settings.updated");
        expect(events.some((event) => event.metadata.sections.includes("smtp"))).toBe(true);
        expect(JSON.stringify(events)).not.toContain(secret);
      });
    } finally {
      await app.service.patch("/admin/settings", { smtp: { host: "" } });
    }
  },
);

test(
  "a server that refuses the recipient makes the SMTP test a 502 SMTP_SEND_FAILED",
  {
    tag: "@settings",
    annotation: about(
      "When the SMTP server answers 550 to the recipient, the test fails with 502 SMTP_SEND_FAILED. So does a host nothing listens on. Accepting recipients again makes the same call succeed.",
    ),
  },
  async () => {
    const root = await app.root();
    const server = await sink();
    await pointAtSink();
    try {
      await step("The fake server refuses every recipient", async () => {
        server.refuseRecipients("550 no");
        const refused = await root.api.post("/admin/settings/smtp/test", { to: app.email("nope") });
        expect(refused.status).toBe(502);
        expect(refused.code).toBe("SMTP_SEND_FAILED");
      });
      await step("A sign-up still succeeds while its email is refused", async () => {
        const email = app.email("quiet");
        const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
        expect(signedUp.status).toBe(201);
      });
      await step("It works again once the server accepts recipients", async () => {
        server.refuseRecipients(undefined);
        const to = app.email("yes");
        const sent = await root.api.post("/admin/settings/smtp/test", { to });
        expect(sent.status).toBe(200);
        await mailTo(to);
      });
      await step("A host with nothing listening is SMTP_SEND_FAILED", async () => {
        const closed = await startSmtp();
        const port = closed.port;
        await closed.stop();
        await pointAtSink({ port });
        const refused = await root.api.post("/admin/settings/smtp/test", { to: app.email("dead") });
        expect(refused.status).toBe(502);
        expect(refused.code).toBe("SMTP_SEND_FAILED");
      });
    } finally {
      server.refuseRecipients(undefined);
      await app.service.patch("/admin/settings", { smtp: { host: "" } });
    }
  },
);

test(
  "only admins and the service key may use the SMTP test",
  {
    tag: ["@settings", "@security"],
    annotation: about(
      "No token is 401 and a user's token is 403, and nothing is sent in either case.",
    ),
  },
  async () => {
    const user = await app.user("mailer");
    await pointAtSink();
    try {
      const server = await sink();
      const before = server.messages.length;
      await step("No token is 401", async () => {
        const refused = await app.api.post("/admin/settings/smtp/test", { to: user.email });
        expect(refused.status).toBe(401);
      });
      await step("A user's token is 403 AUTHORIZATION_DENIED", async () => {
        const refused = await user.api.post("/admin/settings/smtp/test", { to: user.email });
        expect(refused.status).toBe(403);
        expect(refused.code).toBe("AUTHORIZATION_DENIED");
      });
      await step("No message was sent", async () => {
        await new Promise((wait) => setTimeout(wait, 300));
        expect(server.messages.length).toBe(before);
      });
    } finally {
      await app.service.patch("/admin/settings", { smtp: { host: "" } });
    }
  },
);
