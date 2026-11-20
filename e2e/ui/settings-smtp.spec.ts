import type { Page } from "@playwright/test";
import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { startSmtp } from "../harness/smtp.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const smtp = (page: Page) => page.getByTestId("settings-smtp");
const form = (page: Page) => page.getByTestId("settings-smtp-form");
const save = (page: Page) => form(page).getByRole("button", { name: "Save", exact: true });
const testTo = (page: Page) => smtp(page).getByLabel("Send test emails to");
const sendTest = (page: Page) => smtp(page).getByRole("button", { name: "Send test email" });

async function smtpSettings() {
  return (await (await app.root()).api.get("/admin/settings", { record: false })).data.smtp;
}

/** Puts email back in the log and test emails back on root, whatever a test did. */
test.afterEach(async () => {
  const root = await app.root();
  await root.api.patch(
    "/admin/settings",
    { smtp: { host: null, password: "" }, testEmail: { recipient: null } },
    { record: false },
  );
});

test(
  "without a host the section says emails go to the server log",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "A new instance has no SMTP server. The card says so, the form is empty with the STARTTLS defaults, and the test button reports that nothing is set up.",
    ),
  },
  async ({ page }) => {
    await step("Open Settings", async () => {
      await openAs(page, await app.root(), "/settings");
      await seeHeading(page, "Settings");
      await expect(smtp(page)).toBeVisible();
    });
    await step("The source is the log and the form can be edited", async () => {
      await expect(
        smtp(page).getByText("No SMTP server is set, so Dopgate writes emails to the server log."),
      ).toBeVisible();
      await expect(form(page)).toBeVisible();
      expect((await smtpSettings()).source).toBe("log");
    });
    await step("The fields hold the defaults", async () => {
      await expect(form(page).getByLabel("Host")).toHaveValue("");
      await expect(form(page).getByLabel("Port")).toHaveValue("587");
      await expect(form(page).getByLabel("Security")).toHaveValue("starttls");
      await expect(form(page).getByLabel("Username")).toHaveValue("");
      await expect(form(page).getByLabel("From address")).toHaveValue("no-reply@dopgate.com");
      await expect(save(page)).toBeDisabled();
    });
    await step("Send test email reports that SMTP isn't set up", async () => {
      await expect(testTo(page)).toHaveValue("");
      await expect(testTo(page)).toHaveAttribute("placeholder", ROOT_EMAIL);
      await sendTest(page).click();
      await expect(smtp(page).getByRole("alert")).toBeVisible();
      await expect(smtp(page).getByText(/Test email sent/)).toHaveCount(0);
    });
  },
);

test(
  "the SMTP form catches a bad host, port and sender before saving",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "A host with a scheme or credentials, a host with a port, a port outside 1 to 65535 and a malformed sender address each show a message. Picking another security mode moves the default port with it.",
    ),
  },
  async ({ page }) => {
    await step("Open Settings", async () => {
      await openAs(page, await app.root(), "/settings");
      await expect(form(page)).toBeVisible();
    });
    await step("A URL is not a host", async () => {
      await form(page).getByLabel("Host").fill("smtp://mail.example.com");
      await save(page).click();
      await expect(
        form(page).getByText("Enter just the host name, like smtp.example.com."),
      ).toBeVisible();
    });
    await step("A host with a port is sent to the Port field", async () => {
      await form(page).getByLabel("Host").fill("mail.example.com:587");
      await save(page).click();
      await expect(form(page).getByText("Put the port in the Port field.")).toBeVisible();
    });
    await step("A port of 70000 is refused", async () => {
      await form(page).getByLabel("Host").fill("mail.example.com");
      await form(page).getByLabel("Port").fill("70000");
      await save(page).click();
      await expect(form(page).getByText("Enter a port from 1 to 65535.")).toBeVisible();
    });
    await step("A malformed sender address is refused", async () => {
      await form(page).getByLabel("Port").fill("587");
      await form(page).getByLabel("From address").fill("not-an-address");
      await save(page).click();
      await expect(form(page).getByText("Enter a valid email address.")).toBeVisible();
    });
    await step("Nothing was stored", async () => {
      expect((await smtpSettings()).host).toBeNull();
    });
    await step("Choosing TLS moves the default port to 465, then None to 25", async () => {
      await form(page).getByLabel("Port").fill("587");
      await form(page).getByLabel("Security").selectOption({ label: "TLS (usually port 465)" });
      await expect(form(page).getByLabel("Port")).toHaveValue("465");
      await form(page).getByLabel("Security").selectOption({ label: "None (usually port 25)" });
      await expect(form(page).getByLabel("Port")).toHaveValue("25");
    });
    await step("A custom port stays put when the security changes", async () => {
      await form(page).getByLabel("Port").fill("2525");
      await form(page).getByLabel("Security").selectOption({ label: "STARTTLS (usually port 587)" });
      await expect(form(page).getByLabel("Port")).toHaveValue("2525");
    });
    await step("Discard puts the saved values back", async () => {
      await form(page).getByRole("button", { name: "Discard" }).click();
      await expect(form(page).getByLabel("Host")).toHaveValue("");
      await expect(form(page).getByLabel("Port")).toHaveValue("587");
      await expect(save(page)).toBeDisabled();
    });
  },
);

test(
  "saving a host makes it the source and the test email arrives there",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "The form points at a fake SMTP server on this machine with no encryption. After saving, the card says the database holds the setup, the test email reaches the fake server, and so does the next real email.",
    ),
  },
  async ({ page }) => {
    const sink = await startSmtp();
    try {
      await step("Open Settings and fill in the SMTP form", async () => {
        await openAs(page, await app.root(), "/settings");
        await expect(form(page)).toBeVisible();
        await form(page).getByLabel("Host").fill("127.0.0.1");
        await form(page).getByLabel("Security").selectOption({ label: "None (usually port 25)" });
        await form(page).getByLabel("Port").fill(String(sink.port));
        await form(page).getByLabel("From address").fill("hello@acme.test");
        await form(page).getByLabel("From name").fill("Acme Auth");
      });
      await step("Save", async () => {
        await save(page).click();
        await expect(form(page).getByText("Saved", { exact: true })).toBeVisible();
        await expect(
          smtp(page).getByText(
            "Dopgate sends email through this server.",
            { exact: false },
          ),
        ).toBeVisible();
      });
      await step("The server holds the new source and values", async () => {
        const saved = await smtpSettings();
        expect(saved).toMatchObject({
          host: "127.0.0.1",
          port: sink.port,
          security: "none",
          fromEmail: "hello@acme.test",
          fromName: "Acme Auth",
          source: "database",
        });
      });
      await step("A reload shows the same form", async () => {
        await page.reload();
        await expect(form(page).getByLabel("Host")).toHaveValue("127.0.0.1");
        await expect(form(page).getByLabel("Port")).toHaveValue(String(sink.port));
        await expect(form(page).getByLabel("From name")).toHaveValue("Acme Auth");
      });
      await step("With no test address, the test email goes to root", async () => {
        await sendTest(page).click();
        await expect(smtp(page).getByText(`Test email sent to ${ROOT_EMAIL}.`)).toBeVisible();
        await expect.poll(() => sink.messages.filter((m) => m.to === ROOT_EMAIL).length).toBe(1);
        const mail = sink.messages.find((m) => m.to === ROOT_EMAIL)!;
        expect(mail.raw).toContain("hello@acme.test");
        expect(mail.raw).toContain("Acme Auth");
      });
      const to = app.email("tester");
      await step("A typed test address is saved and gets the test email", async () => {
        await testTo(page).fill(to);
        await sendTest(page).click();
        await expect(smtp(page).getByText(`Test email sent to ${to}.`)).toBeVisible();
        await expect.poll(() => sink.messages.filter((m) => m.to === to).length).toBe(1);
        const saved = await (await app.root()).api.get("/admin/settings", { record: false });
        expect(saved.data.testEmail.recipient).toBe(to);
        await page.reload();
        await expect(testTo(page)).toHaveValue(to);
      });
      await step("Clearing the test address sends to root again", async () => {
        await testTo(page).fill("");
        await sendTest(page).click();
        await expect(smtp(page).getByText(`Test email sent to ${ROOT_EMAIL}.`)).toBeVisible();
        await expect.poll(() => sink.messages.filter((m) => m.to === ROOT_EMAIL).length).toBe(2);
      });
      await step("A real email goes through the same server", async () => {
        const email = app.email("realmail");
        const created = await app.api.post(
          "/auth/signup",
          { email, password: PASSWORD },
          { record: false },
        );
        expect(created.status).toBe(201);
        await expect.poll(() => sink.messages.some((m) => m.to === email)).toBe(true);
      });
      await step("A malformed test address is caught by the form", async () => {
        await testTo(page).fill("nope");
        await sendTest(page).click();
        await expect(smtp(page).getByText("Enter a valid email address.")).toBeVisible();
      });
    } finally {
      await sink.stop();
    }
  },
);

test(
  "a test email the SMTP server refuses shows the failure",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "When the fake SMTP server rejects the recipient, Send test email shows an error in the card instead of a success note.",
    ),
  },
  async ({ page }) => {
    const sink = await startSmtp();
    try {
      await step("Point Dopgate at the fake server", async () => {
        await app.settings("smtp", {
          host: "127.0.0.1",
          port: sink.port,
          security: "none",
        });
        sink.refuseRecipients("550 5.1.1 no such user");
        await openAs(page, await app.root(), "/settings");
        await expect(form(page).getByLabel("Host")).toHaveValue("127.0.0.1");
      });
      await step("Send a test email", async () => {
        await sendTest(page).click();
      });
      await step("The card shows an error, not a success note", async () => {
        await expect(smtp(page).getByRole("alert")).toBeVisible();
        await expect(smtp(page).getByText(/Test email sent/)).toHaveCount(0);
        expect(sink.messages).toHaveLength(0);
      });
    } finally {
      await sink.stop();
    }
  },
);

test(
  "the SMTP password can be set, kept and removed",
  {
    tag: ["@settings", "@console", "@security"],
    annotation: about(
      "A password typed into the form is stored and the field then says one is saved. Saving other fields with the box empty keeps it. Remove the saved password clears it. The server never sends it back.",
    ),
  },
  async ({ page }) => {
    const sink = await startSmtp();
    const secret = app.value();
    try {
      await step("Fill in a host, a username and a password", async () => {
        await openAs(page, await app.root(), "/settings");
        await expect(form(page)).toBeVisible();
        await expect(form(page).getByText("Stored encrypted.")).toBeVisible();
        await form(page).getByLabel("Host").fill("127.0.0.1");
        await form(page).getByLabel("Security").selectOption({ label: "None (usually port 25)" });
        await form(page).getByLabel("Port").fill(String(sink.port));
        await form(page).getByLabel("Username").fill("mailer");
        await form(page).getByLabel("Password", { exact: true }).fill(secret);
        await save(page).click();
        await expect(form(page).getByText("Saved", { exact: true }).first()).toBeVisible();
      });
      await step("The field now says a password is saved, and the API never returns it", async () => {
        const saved = await smtpSettings();
        expect(saved.passwordSet).toBe(true);
        expect(saved.username).toBe("mailer");
        expect(JSON.stringify(saved)).not.toContain(secret);
        await expect(form(page).getByLabel("Password", { exact: true })).toHaveValue("");
        await expect(form(page).getByLabel("Password", { exact: true })).toHaveAttribute(
          "placeholder",
          "Saved",
        );
        await expect(
          form(page).getByText("Saved and encrypted. Leave empty to keep it."),
        ).toBeVisible();
      });
      await step("Changing the sender with an empty password box keeps the password", async () => {
        await form(page).getByLabel("From name").fill("Keeper");
        await save(page).click();
        await expect(form(page).getByText("Saved", { exact: true }).first()).toBeVisible();
        const saved = await smtpSettings();
        expect(saved.fromName).toBe("Keeper");
        expect(saved.passwordSet).toBe(true);
      });
      await step("Remove the saved password asks nothing and clears it on save", async () => {
        await form(page).getByRole("button", { name: "Remove the saved password" }).click();
        await expect(
          form(page).getByText("The saved password is removed when you save."),
        ).toBeVisible();
        await expect(form(page).getByLabel("Password", { exact: true })).toBeDisabled();
        await form(page).getByRole("button", { name: "Keep the saved password" }).click();
        await expect(form(page).getByLabel("Password", { exact: true })).toBeEnabled();
        await form(page).getByRole("button", { name: "Remove the saved password" }).click();
        await save(page).click();
        await expect(form(page).getByText("Saved", { exact: true }).first()).toBeVisible();
        expect((await smtpSettings()).passwordSet).toBe(false);
        await expect(
          form(page).getByRole("button", { name: "Remove the saved password" }),
        ).toHaveCount(0);
      });
    } finally {
      await sink.stop();
    }
  },
);

test(
  "clearing the host sends emails back to the server log",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "After SMTP was set up, emptying the Host field and saving returns the source to the log, and the next email shows up in the log instead of at the SMTP server.",
    ),
  },
  async ({ page }) => {
    const sink = await startSmtp();
    try {
      await step("Start with SMTP set up through the API", async () => {
        await app.settings("smtp", { host: "127.0.0.1", port: sink.port, security: "none" });
        await openAs(page, await app.root(), "/settings");
        await expect(form(page).getByLabel("Host")).toHaveValue("127.0.0.1");
      });
      await step("Empty the host and save", async () => {
        await form(page).getByLabel("Host").fill("");
        await save(page).click();
        await expect(form(page).getByText("Saved", { exact: true }).first()).toBeVisible();
        await expect(
          smtp(page).getByText("No SMTP server is set, so Dopgate writes emails to the server log."),
        ).toBeVisible();
        expect((await smtpSettings()).source).toBe("log");
      });
      await step("The next email is in the log, not at the SMTP server", async () => {
        const email = app.email("logged");
        const created = await app.api.post(
          "/auth/signup",
          { email, password: PASSWORD },
          { record: false },
        );
        expect(created.status).toBe(201);
        expect(await app.mail.code(email)).toMatch(/^\d{6}$/);
        expect(sink.messages.some((m) => m.to === email)).toBe(false);
      });
    } finally {
      await sink.stop();
    }
  },
);
