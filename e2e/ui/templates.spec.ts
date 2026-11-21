import { about, expect, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const SIX = [
  { name: "verify_email", title: "Verify email" },
  { name: "login_code", title: "Sign-in code" },
  { name: "password_reset", title: "Password reset" },
  { name: "email_change", title: "Email change" },
  { name: "email_changed", title: "Email changed" },
  { name: "password_changed", title: "Password changed" },
];

test(
  "the list shows the six built-in emails and none is customized",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "A new instance lists the six emails Dopgate sends, each with its readable title, its name, what it is for and the subject in use. None carries the Customized badge.",
    ),
  },
  async ({ page }) => {
    await step("Open the Email templates page", async () => {
      await openAs(page, await app.root(), "/templates");
      await seeHeading(page, "Email templates");
      await expect(page.getByTestId("templates-list")).toBeVisible();
    });
    await step("Six templates are listed, in order, by title and name", async () => {
      const items = page.getByTestId("templates-list").getByRole("listitem");
      await expect(items).toHaveCount(6);
      for (const [index, template] of SIX.entries()) {
        await expect(items.nth(index)).toContainText(template.title);
        await expect(items.nth(index)).toContainText(template.name);
      }
    });
    await step("Each row shows a description and its subject", async () => {
      const items = page.getByTestId("templates-list").getByRole("listitem");
      for (let index = 0; index < 6; index++) {
        await expect(items.nth(index)).toContainText("Subject:");
      }
      const listed = await (await app.root()).api.get("/admin/email-templates", { record: false });
      for (const template of listed.data) {
        const row = items.filter({
          has: page.getByText(template.name, { exact: true }),
        });
        await expect(row).toContainText(template.description);
        await expect(row).toContainText(template.subject);
      }
    });
    await step("Every row says Built-in and none says Customized", async () => {
      await expect(
        page.getByTestId("templates-list").getByText("Built-in", { exact: true }),
      ).toHaveCount(6);
      await expect(page.getByText("Customized")).toHaveCount(0);
    });
  },
);

test(
  "a customized template is marked in the list and opens from its row",
  {
    tag: ["@templates", "@console"],
    annotation: about(
      "After an admin saves an override through the API, the list marks that one email as Customized with the edit time and shows its new subject. Clicking a row opens the template page.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    const subject = `${app.uniq("Code")} {{code}} for {{app_name}}`;
    await step("PUT an override for the sign-in code email", async () => {
      const saved = await root.api.put(
        "/admin/email-templates/login_code",
        { subject, html: "<p>{{code}}</p>", text: "{{code}}" },
        { record: false },
      );
      expect(saved.status).toBe(200);
    });
    await step("Open the list", async () => {
      await openAs(page, root, "/templates");
      await expect(page.getByTestId("templates-list").getByRole("listitem")).toHaveCount(6);
    });
    const row = page
      .getByTestId("templates-list")
      .getByRole("listitem")
      .filter({ hasText: "login_code" });
    await step("Only the sign-in code row is Customized, with its new subject", async () => {
      await expect(page.getByText("Customized")).toHaveCount(1);
      await expect(row).toContainText("Customized");
      await expect(row).toContainText("Edited just now");
      await expect(row).toContainText(subject);
    });
    await step("Clicking the row opens the template", async () => {
      await row.getByRole("link").click();
      await expect(page).toHaveURL(/\/templates\/login_code$/);
      await seeHeading(page, "Sign-in code");
    });
    await step("Its Email templates link leads back to the list", async () => {
      await page.getByRole("link", { name: "Email templates", exact: true }).first().click();
      await expect(page).toHaveURL(/\/templates$/);
    });
    await step("Reset it through the API and the badge goes", async () => {
      const reset = await root.api.delete("/admin/email-templates/login_code", undefined, {
        record: false,
      });
      expect(reset.status).toBe(200);
      await page.reload();
      await expect(page.getByTestId("templates-list").getByRole("listitem")).toHaveCount(6);
      await expect(page.getByText("Customized")).toHaveCount(0);
    });
  },
);
