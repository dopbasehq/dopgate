import type { Page } from "@playwright/test";
import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const dialog = (page: Page) => page.getByRole("dialog", { name: "Add admin" });
const rowOf = (page: Page, email: string) =>
  page.getByTestId("admin-row").filter({ hasText: email });

/** Opens one row's Actions menu and picks an item. */
async function pickAction(page: Page, email: string, item: string) {
  await rowOf(page, email).getByTestId("admin-actions").click();
  await page.getByRole("menuitem", { name: item }).click();
}

test(
  "root sees itself first, marked, with no actions on its own row",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "The Admins table lists root first with a Root badge and a mark for the signed-in admin. Root's own row has no Actions menu, so root can't turn itself off or remove itself.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam", { displayName: "Sam Rivers" });
    await step("Open the Admins page as root", async () => {
      await openAs(page, await app.root(), "/admins");
      await seeHeading(page, "Admins");
      await expect(page.getByTestId("admins-table")).toBeVisible();
    });
    await step("Root is the first row, with a Root badge and a you mark", async () => {
      const first = page.getByTestId("admin-row").first();
      await expect(first).toContainText(ROOT_EMAIL);
      await expect(first).toContainText("you");
      await expect(first).toContainText("Root");
      await expect(first).toContainText("Active");
    });
    await step("Root's row has no Actions menu", async () => {
      await expect(rowOf(page, ROOT_EMAIL).getByTestId("admin-actions")).toHaveCount(0);
    });
    await step("Another admin shows name, role and an Actions menu", async () => {
      const row = rowOf(page, sam.email);
      await expect(row).toContainText("Sam Rivers");
      await expect(row).toContainText("Admin");
      await expect(row).not.toContainText("you");
      await expect(row.getByTestId("admin-actions")).toBeVisible();
    });
    await step("The server protects root too", async () => {
      const root = await app.root();
      const disable = await root.api.post(`/admin/admins/${root.id}/disable`, undefined, { record: false });
      expect(disable.status).toBe(403);
      expect(disable.code).toBe("ROOT_PROTECTED");
      const remove = await root.api.delete(`/admin/admins/${root.id}`, undefined, { record: false });
      expect(remove.status).toBe(403);
      expect(remove.code).toBe("ROOT_PROTECTED");
    });
  },
);

test(
  "root adds an admin with a password and they can sign in",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "Add admin takes an email, a display name and a password. The admin appears in the table and signs in to the console with that password.",
    ),
  },
  async ({ page }) => {
    const email = app.email("newadmin");
    await step("Open the Add admin dialog", async () => {
      await openAs(page, await app.root(), "/admins");
      await page.getByTestId("new-admin").click();
      await expect(dialog(page)).toBeVisible();
    });
    await step("Fill in the form and add", async () => {
      await dialog(page).getByLabel("Email").fill(email);
      await dialog(page).getByLabel("Display name").fill("Nia Park");
      await dialog(page).getByLabel("Password", { exact: true }).fill(PASSWORD);
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
    });
    await step("The dialog closes with a note and the row appears", async () => {
      await expect(dialog(page)).toHaveCount(0);
      await expect(
        page.getByText(`Added ${email}. They can sign in to this console now.`),
      ).toBeVisible();
      const row = rowOf(page, email);
      await expect(row).toContainText("Nia Park");
      await expect(row).toContainText("Admin");
      await expect(row).toContainText("Active");
      await expect(row).toContainText("Never");
    });
    await step("The new admin signs in with the password", async () => {
      const session = await app.consoleSession(email);
      expect(session.role).toBe("admin");
      const me = await session.api.get("/console/me", { record: false });
      expect(me.data.displayName).toBe("Nia Park");
    });
  },
);

test(
  "an admin added without a password signs in with an emailed code",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "Leaving the password empty makes an account that signs in with a code. The code arrives by email and signs them in to the console.",
    ),
  },
  async ({ page }) => {
    const email = app.email("codeadmin");
    await step("Add an admin and leave the password empty", async () => {
      await openAs(page, await app.root(), "/admins");
      await page.getByTestId("new-admin").click();
      await dialog(page).getByLabel("Email").fill(email);
      await expect(
        dialog(page).getByText("Leave empty to have them sign in with an email code."),
      ).toBeVisible();
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
      await expect(rowOf(page, email)).toBeVisible();
      await expect(rowOf(page, email)).toContainText("None");
    });
    const anonymous = await app.anonymousApi();
    await step("A password sign-in fails", async () => {
      const refused = await anonymous.post(
        "/console/login",
        { email, password: PASSWORD },
        { record: false },
      );
      expect(refused.ok).toBe(false);
    });
    await step("POST /console/codes/send emails a code that signs them in", async () => {
      const sent = await anonymous.post("/console/codes/send", { email }, { record: false });
      expect(sent.status).toBe(200);
      const code = await app.mail.code(email);
      const confirmed = await anonymous.post(
        "/console/codes/confirm",
        { email, purpose: "login", code },
        { record: false },
      );
      expect(confirmed.status).toBe(200);
      expect(confirmed.data.admin.email).toBe(email);
    });
  },
);

test(
  "the Add admin form catches bad input and the server's refusals",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "An empty or malformed email is caught in the form. An email an admin already uses and a password the server rejects each show a message at their field.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("taken");
    await step("Open the Add admin dialog", async () => {
      await openAs(page, await app.root(), "/admins");
      await page.getByTestId("new-admin").click();
    });
    await step("An empty email is refused", async () => {
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
      await expect(dialog(page).getByText("Enter an email address.")).toBeVisible();
    });
    await step("A malformed email is refused", async () => {
      await dialog(page).getByLabel("Email").fill("not-an-email");
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
      await expect(dialog(page).getByText("Enter a valid email address.")).toBeVisible();
    });
    await step("An email an admin already has is refused by the server", async () => {
      await dialog(page).getByLabel("Email").fill(sam.email);
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
      await expect(
        dialog(page).getByText("An admin with this email already exists."),
      ).toBeVisible();
      await expect(dialog(page)).toBeVisible();
    });
    await step("Root's own email is taken too", async () => {
      await dialog(page).getByLabel("Email").fill(ROOT_EMAIL);
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
      await expect(
        dialog(page).getByText("An admin with this email already exists."),
      ).toBeVisible();
    });
    await step("A password that is too short gets the server's message", async () => {
      await dialog(page).getByLabel("Email").fill(app.email("shortpass"));
      await dialog(page).getByLabel("Password", { exact: true }).fill("short");
      await dialog(page).getByRole("button", { name: "Add admin" }).click();
      await expect(
        dialog(page).getByText(/^Use at least \d+ characters\.$/),
      ).toBeVisible();
      await expect(dialog(page)).toBeVisible();
    });
    await step("Cancel closes the dialog", async () => {
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(dialog(page)).toHaveCount(0);
    });
  },
);

test(
  "turning an admin off signs them out and blocks sign-in until turned back on",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "Turn off asks first. The row shows Turned off, the admin's session ends and signing in is refused. Turn back on needs no confirmation and sign-in works again.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("switch");
    await step("Open the Admins page and choose Turn off on Sam's row", async () => {
      await openAs(page, await app.root(), "/admins");
      await pickAction(page, sam.email, "Turn off");
      await expect(
        page.getByRole("dialog", { name: `Turn off ${sam.email}?` }),
      ).toBeVisible();
    });
    await step("Cancel leaves them on", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(rowOf(page, sam.email)).toContainText("Active");
      expect((await sam.api.get("/console/me", { record: false })).status).toBe(200);
    });
    await step("Confirm turns them off", async () => {
      await pickAction(page, sam.email, "Turn off");
      await page.getByRole("button", { name: "Turn off", exact: true }).click();
      await expect(
        page.getByText(`${sam.email} is turned off and signed out.`),
      ).toBeVisible();
      await expect(rowOf(page, sam.email)).toContainText("Turned off");
    });
    await step("Their open session no longer works", async () => {
      const me = await sam.api.get("/console/me", { record: false });
      expect(me.ok).toBe(false);
    });
    await step("Signing in is refused", async () => {
      const anonymous = await app.anonymousApi();
      const refused = await anonymous.post(
        "/console/login",
        { email: sam.email, password: PASSWORD },
        { record: false },
      );
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe("ACCOUNT_DISABLED");
    });
    await step("Turn back on, with no confirmation", async () => {
      await pickAction(page, sam.email, "Turn back on");
      await expect(page.getByText(`${sam.email} can sign in again.`)).toBeVisible();
      await expect(rowOf(page, sam.email)).toContainText("Active");
    });
    await step("They can sign in again", async () => {
      const again = await app.consoleSession(sam.email);
      expect(again.email).toBe(sam.email);
    });
  },
);

test(
  "removing an admin asks first and deletes their account",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "Remove admin asks for confirmation. After it the row is gone, the admin can't sign in and the audit log still has what they did.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("leaving");
    await step("Choose Remove admin on Sam's row", async () => {
      await openAs(page, await app.root(), "/admins");
      await pickAction(page, sam.email, "Remove admin");
      await expect(
        page.getByRole("dialog", { name: `Remove ${sam.email}?` }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Their admin account and console sessions are deleted. The audit log keeps what they did.",
        ),
      ).toBeVisible();
    });
    await step("Cancel keeps the row", async () => {
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(rowOf(page, sam.email)).toBeVisible();
    });
    await step("Confirm removes the row", async () => {
      await pickAction(page, sam.email, "Remove admin");
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(page.getByText(`Removed ${sam.email}.`)).toBeVisible();
      await expect(rowOf(page, sam.email)).toHaveCount(0);
    });
    await step("They can no longer sign in", async () => {
      const refused = await (await app.anonymousApi()).post(
        "/console/login",
        { email: sam.email, password: PASSWORD },
        { record: false },
      );
      expect(refused.ok).toBe(false);
    });
    await step("The audit log kept their sign-in", async () => {
      const root = await app.root();
      const events = await root.api.get(`/admin/audit-events?actor=${encodeURIComponent(sam.email)}`, {
        record: false,
      });
      expect(events.data.items.length).toBeGreaterThan(0);
    });
  },
);

test(
  "an admin who is not root sees the list but cannot change it",
  {
    tag: ["@admins", "@console", "@security"],
    annotation: about(
      "A plain admin gets a note that only root manages admins, no Add admin button and no Actions menus. The server refuses the same calls.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("plain");
    const other = await app.admin("bystander");
    await step("Sam opens the Admins page", async () => {
      await openAs(page, sam, "/admins");
      await seeHeading(page, "Admins");
      await expect(rowOf(page, other.email)).toBeVisible();
    });
    await step("A note says only root can manage admins", async () => {
      await expect(
        page.getByText("Only root can add, turn off, or remove admins."),
      ).toBeVisible();
    });
    await step("There is no Add admin button and no Actions menu", async () => {
      await expect(page.getByTestId("new-admin")).toHaveCount(0);
      await expect(page.getByTestId("admin-actions")).toHaveCount(0);
      await expect(rowOf(page, sam.email)).toContainText("you");
    });
    await step("The server refuses Sam's calls", async () => {
      const add = await sam.api.post(
        "/admin/admins",
        { email: app.email("sneaky"), password: PASSWORD },
        { record: false },
      );
      expect(add.status).toBe(403);
      const disable = await sam.api.post(`/admin/admins/${other.id}/disable`, undefined, {
        record: false,
      });
      expect(disable.status).toBe(403);
    });
  },
);
