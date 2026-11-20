import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const save = (page: import("@playwright/test").Page) => page.getByTestId("save-template");
/** Picks the body the editor and the preview show: "HTML" or "Plain text". */
const showBody = (page: import("@playwright/test").Page, body: "HTML" | "Plain text") =>
  page.getByRole("radio", { name: body, exact: true }).click();

test(
  "a template page shows subject, HTML, text and the variables it accepts",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "The verify email page fills the three fields from the built-in version, marks it Built-in, lists its five variables and shows a preview rendered with sample values.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const read = await root.api.get("/admin/email-templates/verify_email", { record: false });
    await step("Open the verify email template", async () => {
      await openAs(page, root, "/templates/verify_email");
      await seeHeading(page, "Verify email");
    });
    await step("It is Built-in and the fields hold the built-in text", async () => {
      await expect(page.getByText("Built-in", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Subject")).toHaveValue(read.data.subject);
      await expect(page.getByLabel("HTML")).toHaveValue(read.data.html);
      await showBody(page, "Plain text");
      await expect(page.getByLabel("Plain text")).toHaveValue(read.data.text);
      await showBody(page, "HTML");
    });
    await step("Save is off and Reset is not offered", async () => {
      await expect(save(page)).toBeDisabled();
      await expect(page.getByRole("button", { name: "Reset to built-in" })).toHaveCount(0);
    });
    await step("The variables for this email are listed", async () => {
      for (const variable of ["app_name", "email", "display_name", "code", "expires_minutes"]) {
        await expect(page.getByRole("button", { name: `Copy {{${variable}}}` })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Copy {{new_email}}" })).toHaveCount(0);
    });
    await step("The preview has the sample code and the app name", async () => {
      await expect(page.getByText("Rendered by the server with sample values.")).toBeVisible();
      const frame = page.frameLocator('iframe[title="HTML preview"]');
      await expect(frame.locator("body")).toContainText("482913");
      await expect(frame.locator("body")).toContainText("Dopgate");
    });
    await step("Switching the body to Plain text shows the plain text rendering", async () => {
      await showBody(page, "Plain text");
      await expect(page.locator("pre")).toContainText("482913");
      await showBody(page, "HTML");
    });
  },
);

test(
  "clicking a variable copies its placeholder",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "Each variable is a button. Clicking it puts the placeholder, such as {{code}}, on the clipboard.",
    ),
  },
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await step("Open the email change template", async () => {
      await openAs(page, await app.root(), "/templates/email_change");
      await seeHeading(page, "Email change");
    });
    await step("Click {{new_email}}", async () => {
      await page.getByRole("button", { name: "Copy {{new_email}}" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("{{new_email}}");
    });
  },
);

test(
  "the preview follows what is typed, before anything is saved",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "Typing in the subject and HTML boxes re-renders the preview from the server. The page shows Unsaved changes and nothing is stored until Save.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const marker = app.uniq("Preview");
    await step("Open the password changed template", async () => {
      await openAs(page, root, "/templates/password_changed");
      await seeHeading(page, "Password changed");
    });
    await step("Edit the subject and the HTML", async () => {
      await page.getByLabel("Subject").fill(`${marker} for {{email}}`);
      await page.getByLabel("HTML").fill("<p>Hello {{display_name}} at {{app_name}}</p>");
      await showBody(page, "Plain text");
      await page.getByLabel("Plain text").fill("Plain hello {{display_name}}");
    });
    await step("The preview shows sample values in place of variables", async () => {
      await expect(page.getByRole("region", { name: "Preview" })).toContainText(
        `${marker} for ${ROOT_EMAIL}`,
      );
      await expect(page.locator("pre")).toContainText("Plain hello Alex");
      await showBody(page, "HTML");
      const frame = page.frameLocator('iframe[title="HTML preview"]');
      await expect(frame.locator("body")).toContainText("Hello Alex at Dopgate");
    });
    await step("The page says the changes are unsaved", async () => {
      await expect(page.getByText("Unsaved changes")).toBeVisible();
      await expect(save(page)).toBeEnabled();
    });
    await step("Nothing is stored on the server", async () => {
      const read = await root.api.get("/admin/email-templates/password_changed", { record: false });
      expect(read.data.customized).toBe(false);
    });
  },
);

test(
  "saving marks the template customized and the next real email uses it",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "An edited verify email is saved. The page and the list show it as Customized. The next sign-up sends an email with the new subject and text, and the audit log records the save.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const label = app.uniq("Acme");
    await step("Open the verify email template and change all three fields", async () => {
      await openAs(page, root, "/templates/verify_email");
      await seeHeading(page, "Verify email");
      await page.getByLabel("Subject").fill(`${label}: {{code}} confirms {{email}}`);
      await page.getByLabel("HTML").fill("<p>Your {{app_name}} code is <b>{{code}}</b></p>");
      await showBody(page, "Plain text");
      await page.getByLabel("Plain text").fill(`${label} code {{code}} lasts {{expires_minutes}} minutes`);
    });
    await step("Save", async () => {
      await save(page).click();
      await expect(page.getByText("Template saved.")).toBeVisible();
      await expect(page.getByText("Customized", { exact: true })).toBeVisible();
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);
      await expect(save(page)).toBeDisabled();
    });
    await step("A reload keeps the saved text", async () => {
      await page.reload();
      await expect(page.getByLabel("Subject")).toHaveValue(`${label}: {{code}} confirms {{email}}`);
      await expect(page.getByText("Customized", { exact: true })).toBeVisible();
    });
    const email = app.email("signup");
    await step("POST /auth/signup sends the customized email", async () => {
      const signup = await app.api.post("/auth/signup", { email, password: PASSWORD }, { record: false });
      expect(signup.status, JSON.stringify(signup.body)).toBe(201);
      const mail = await app.mail.last(email);
      expect(mail.subject).toBe(`${label}: ${await app.mail.code(email)} confirms ${email}`);
      expect(mail.text).toContain(`${label} code `);
      expect(mail.text).toMatch(/lasts \d+ minutes/);
    });
    await step("The audit log has email_template.updated", async () => {
      const events = await root.api.get("/admin/audit-events?action=email_template.updated", {
        record: false,
      });
      expect(events.data.items.some((e: any) => e.resourceId === "verify_email")).toBe(true);
    });
    await step("The list marks it Customized", async () => {
      await page.goto("/templates");
      const row = page
        .getByTestId("templates-list")
        .getByRole("listitem")
        .filter({ hasText: "verify_email" });
      await expect(row).toContainText("Customized");
      await expect(row).toContainText(label);
    });
  },
);

test(
  "Send test emails the draft to root, even when another admin sends it",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "Send test renders the draft in the editor, saved or not, with sample values and sends it to the test email address in Settings, which is root's email until someone sets one. Without SMTP it lands in the server log. The template stays unsaved.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("tester");
    const marker = app.uniq("Draft");
    const before = await app.mail.count(ROOT_EMAIL);
    await step("Open the email changed template as Sam", async () => {
      await openAs(page, sam, "/templates/email_changed");
      await seeHeading(page, "Email changed");
    });
    await step("Type a draft subject and press Send test", async () => {
      await page.getByLabel("Subject").fill(`${marker} {{new_email}}`);
      await page.getByRole("button", { name: "Send test" }).click();
      await expect(page.getByText(`Sent a test email to ${ROOT_EMAIL}.`)).toBeVisible();
    });
    await step("The email reaches root with sample values", async () => {
      const mail = await app.mail.last(ROOT_EMAIL, { after: before });
      expect(mail.subject).toBe(`${marker} new.address@example.com`);
    });
    await step("The draft is still unsaved", async () => {
      await expect(page.getByText("Unsaved changes")).toBeVisible();
      const read = await sam.api.get("/admin/email-templates/email_changed", { record: false });
      expect(read.data.customized).toBe(false);
    });
  },
);

test(
  "an invalid template shows the server's message and is not saved",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "A placeholder the email does not accept, or one that is never closed, makes the preview and Save show the server's TEMPLATE_INVALID message. The saved template stays as it was.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    await step("Open the password reset template", async () => {
      await openAs(page, root, "/templates/password_reset");
      await seeHeading(page, "Password reset");
    });
    await step("Use a variable this email does not accept", async () => {
      await page.getByLabel("Subject").fill("Hello {{new_email}}");
    });
    await step("The preview reports the problem", async () => {
      await expect(page.getByRole("alert").filter({ hasText: "new_email" })).toBeVisible();
    });
    await step("Save shows the same message and stores nothing", async () => {
      await save(page).click();
      await expect(page.getByRole("alert").filter({ hasText: "new_email" }).first()).toBeVisible();
      await expect(page.getByText("Template saved.")).toHaveCount(0);
      const read = await root.api.get("/admin/email-templates/password_reset", { record: false });
      expect(read.data.customized).toBe(false);
    });
    await step("An unclosed placeholder is refused too", async () => {
      await page.getByLabel("Subject").fill("Code {{code");
      await save(page).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
      const direct = await root.api.put(
        "/admin/email-templates/password_reset",
        { subject: "Code {{code", html: "<p>x</p>", text: "x" },
        { record: false },
      );
      expect(direct.status).toBe(422);
      expect(direct.code).toBe("TEMPLATE_INVALID");
    });
    await step("An empty subject is refused", async () => {
      await page.getByLabel("Subject").fill("");
      await save(page).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    });
  },
);

test(
  "reset to built-in restores the original text after a confirmation",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "On a customized template, Reset to built-in asks first. Cancelling keeps the override. Confirming puts the built-in text back, drops the Customized badge and the next email uses the built-in subject.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const original = (
      await root.api.get("/admin/email-templates/login_code", { record: false })
    ).data.defaults;
    const label = app.uniq("Custom");
    await step("Save an override through the API and open the page", async () => {
      await root.api.put(
        "/admin/email-templates/login_code",
        { subject: `${label} {{code}}`, html: "<p>{{code}}</p>", text: "{{code}}" },
        { record: false },
      );
      await openAs(page, root, "/templates/login_code");
      await expect(page.getByLabel("Subject")).toHaveValue(`${label} {{code}}`);
      await expect(page.getByText("Customized", { exact: true })).toBeVisible();
    });
    await step("Reset asks for confirmation, and Cancel keeps the override", async () => {
      await page.getByRole("button", { name: "Reset to built-in" }).click();
      await expect(
        page.getByRole("dialog", { name: "Reset to the built-in template?" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByLabel("Subject")).toHaveValue(`${label} {{code}}`);
    });
    await step("Confirm puts the built-in text back", async () => {
      await page.getByRole("button", { name: "Reset to built-in" }).click();
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(page.getByText("Back to the built-in template.")).toBeVisible();
      await expect(page.getByText("Built-in", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Subject")).toHaveValue(original.subject);
      await expect(page.getByLabel("HTML")).toHaveValue(original.html);
      await showBody(page, "Plain text");
      await expect(page.getByLabel("Plain text")).toHaveValue(original.text);
      await expect(page.getByRole("button", { name: "Reset to built-in" })).toHaveCount(0);
    });
    await step("The next sign-in code email has the built-in subject", async () => {
      const user = await app.user("codeuser");
      const sent = await app.api.post(
        "/auth/verification/send",
        { email: user.email, purpose: "login" },
        { record: false },
      );
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      const code = await app.mail.code(user.email);
      const mail = await app.mail.last(user.email);
      const values: Record<string, string> = { code, app_name: "Dopgate", email: user.email };
      const expected = (original.subject as string).replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_, name: string) => values[name] ?? "",
      );
      expect(mail.subject).toBe(expected);
      expect(mail.subject).not.toContain(label);
    });
    await step("The audit log has email_template.reset", async () => {
      const events = await root.api.get("/admin/audit-events?action=email_template.reset", {
        record: false,
      });
      expect(events.data.items.some((e: any) => e.resourceId === "login_code")).toBe(true);
    });
  },
);

test(
  "leaving with unsaved changes asks first",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "With edits in the form, following a link in the sidebar asks to confirm. Dismissing stays on the page with the edits. Accepting leaves. A page with no edits leaves without asking.",
    ),
  },
  async ({ page }) => {
    const prompts: string[] = [];
    let accept = false;
    page.on("dialog", async (dialog) => {
      prompts.push(dialog.message());
      if (accept) await dialog.accept();
      else await dialog.dismiss();
    });
    await step("Open a template and change the subject", async () => {
      await openAs(page, await app.root(), "/templates/email_change");
      await seeHeading(page, "Email change");
      await page.getByLabel("Subject").fill("Edited but not saved");
    });
    await step("Following the Email templates link asks, and dismissing stays", async () => {
      await page.getByRole("link", { name: "Email templates", exact: true }).first().click();
      await expect.poll(() => prompts.length).toBe(1);
      expect(prompts[0]).toBe("Leave without saving? Your changes to this template will be lost.");
      await expect(page).toHaveURL(/\/templates\/email_change$/);
      await expect(page.getByLabel("Subject")).toHaveValue("Edited but not saved");
    });
    await step("Accepting leaves the page", async () => {
      accept = true;
      await page.getByRole("link", { name: "Email templates", exact: true }).first().click();
      await expect(page).toHaveURL(/\/templates$/);
      expect(prompts).toHaveLength(2);
    });
    await step("With nothing edited, leaving asks nothing", async () => {
      await page
        .getByTestId("templates-list")
        .getByRole("link", { name: /email_change\b(?!d)/ })
        .click();
      await expect(page).toHaveURL(/\/templates\/email_change$/);
      await expect(page.getByLabel("Subject")).not.toHaveValue("Edited but not saved");
      await page.getByRole("link", { name: "Email templates", exact: true }).first().click();
      await expect(page).toHaveURL(/\/templates$/);
      expect(prompts).toHaveLength(2);
    });
  },
);

test(
  "an unknown template name shows the server's not-found message",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "An address for an email Dopgate does not send shows the error from the server with a Try again button instead of an empty editor.",
    ),
  },
  async ({ page }) => {
    await step("Open /templates/welcome_email", async () => {
      await openAs(page, await app.root(), "/templates/welcome_email");
    });
    await step("An error and Try again show, with no editor", async () => {
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByLabel("Subject")).toHaveCount(0);
      await expect(save(page)).toHaveCount(0);
    });
  },
);
