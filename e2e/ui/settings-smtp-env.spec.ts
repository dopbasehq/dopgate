import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer({ smtp: "env" });

test(
  "a server started with DOPGATE_SMTP_URL shows the SMTP section read-only",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "When the server's environment sets an SMTP URL, the card says the values come from the server configuration, lists them without a form, and the test email still goes through that server.",
    ),
  },
  async ({ page }) => {
    await step("Open Settings", async () => {
      await openAs(page, await app.root(), "/settings");
      await seeHeading(page, "Settings");
      await expect(page.getByTestId("settings-smtp")).toBeVisible();
    });
    await step("The card says the values come from the server configuration", async () => {
      await expect(
        page
          .getByTestId("settings-smtp")
          .getByText(/Set on the server with DOPGATE_SMTP_\* environment variables, which take priority\./),
      ).toBeVisible();
    });
    await step("There is no form, and the values are listed", async () => {
      await expect(page.getByTestId("settings-smtp-form")).toHaveCount(0);
      const card = page.getByTestId("settings-smtp");
      await expect(card.getByText(`127.0.0.1:${app.server.smtp!.port}`)).toBeVisible();
      await expect(card.getByText("None", { exact: true }).first()).toBeVisible();
      await expect(card.getByText("no-reply@dopbase.com")).toBeVisible();
      await expect(card.getByText("Not set").first()).toBeVisible();
    });
    await step("The server reports server_config as the source", async () => {
      const root = await app.root();
      const settings = (await root.api.get("/admin/settings", { record: false })).data;
      expect(settings.smtp.source).toBe("server_config");
      expect(settings.smtp.host).toBe("127.0.0.1");
    });
    await step("PATCH /admin/settings with smtp is refused", async () => {
      const root = await app.root();
      const refused = await root.api.patch(
        "/admin/settings",
        { smtp: { host: "other.example.com" } },
        { record: false },
      );
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("SETTINGS_INVALID");
    });
    await step("Send test email delivers to root through the server's SMTP", async () => {
      await page.getByRole("button", { name: "Send test email" }).click();
      await expect(page.getByText(`Test email sent to ${ROOT_EMAIL}.`)).toBeVisible();
      await expect
        .poll(() => app.server.smtp!.messages.some((m) => m.to === ROOT_EMAIL))
        .toBe(true);
    });
    await step("Other sections still save", async () => {
      await page.getByTestId("settings-branding").getByLabel("App name").fill("Env Acme");
      await page
        .getByTestId("settings-branding")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(
        page.getByTestId("settings-branding").getByText("Saved", { exact: true }),
      ).toBeVisible();
    });
    await step("A real email arrives at the fake SMTP server too", async () => {
      const email = app.email("envmail");
      const created = await app.api.post(
        "/auth/signup",
        { email, password: PASSWORD },
        { record: false },
      );
      expect(created.status).toBe(201);
      const mail = await app.mail.last(email);
      expect(mail.raw).not.toBe("");
    });
  },
);
