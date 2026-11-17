import { about, expect, step, test, useServer } from "../harness/index.ts";
import { nav, openAs } from "../harness/helpers.ts";

const app = useServer();

const PAGES = [
  { link: "Users", path: "/users", heading: "Users" },
  { link: "Agents", path: "/agents", heading: "Agents" },
  { link: "Templates", path: "/templates", heading: "Email templates" },
  { link: "Admins", path: "/admins", heading: "Admins" },
  { link: "Settings", path: "/settings", heading: "Settings" },
  { link: "Signing keys", path: "/keys", heading: "Signing keys" },
  { link: "Audit log", path: "/audit", heading: "Audit log" },
] as const;

test(
  "every sidebar link opens its page and is marked as the current one",
  {
    tag: ["@console", "@smoke"],
    annotation: about(
      "The sidebar groups seven pages under People, Email and Instance. Each link opens its page, and only that link is marked as the current page.",
    ),
  },
  async ({ page }) => {
    await openAs(page, await app.root(), "/users");
    await step("The sidebar shows its three groups", async () => {
      for (const group of ["People", "Email", "Instance"]) {
        await expect(page.getByRole("region", { name: group })).toBeVisible();
      }
      await expect(page.getByText("Admin Console").first()).toBeVisible();
    });
    for (const target of PAGES) {
      await step(`Open ${target.link}`, async () => {
        await nav(page, target.link).click();
        await expect(page).toHaveURL(new RegExp(`${target.path}$`));
        await expect(page.getByRole("heading", { name: target.heading, level: 1 })).toBeVisible();
        await expect(nav(page, target.link)).toHaveAttribute("aria-current", "page");
        for (const other of PAGES.filter((p) => p.link !== target.link)) {
          await expect(nav(page, other.link)).not.toHaveAttribute("aria-current", "page");
        }
      });
    }
    await step("A page below a section keeps its section marked", async () => {
      const ana = await app.user("ana");
      await page.goto(`/users/${ana.id}`);
      await expect(page.getByRole("heading", { name: ana.email })).toBeVisible();
      await expect(nav(page, "Users")).toHaveAttribute("aria-current", "page");
    });
    await step("The Account page marks no sidebar link", async () => {
      await page.goto("/account");
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
      for (const target of PAGES) {
        await expect(nav(page, target.link)).not.toHaveAttribute("aria-current", "page");
      }
    });
  },
);

test(
  "the account menu opens and closes, and links to Account",
  {
    tag: "@console",
    annotation: about(
      "The sidebar footer shows the signed-in email and role. Clicking it opens a menu with Account and Sign out. Escape and a click elsewhere close it, and so does choosing Account, which opens that page.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await openAs(page, sam, "/users");
    const button = page.getByTestId("account-menu-button");
    const menu = page.getByTestId("account-menu");
    await step("The footer shows the email and role", async () => {
      await expect(button).toContainText(sam.email);
      await expect(button).toContainText("Admin");
      await expect(menu).toBeHidden();
      await expect(button).toHaveAttribute("aria-expanded", "false");
    });
    await step("Click it to open the menu", async () => {
      await button.click();
      await expect(menu).toBeVisible();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(menu.getByRole("link", { name: "Account" })).toBeVisible();
      await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
    });
    await step("Escape closes it", async () => {
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    });
    await step("A click on the page closes it", async () => {
      await button.click();
      await expect(menu).toBeVisible();
      await page.getByRole("heading", { name: "Users", level: 1 }).click();
      await expect(menu).toBeHidden();
    });
    await step("Clicking the footer again closes it too", async () => {
      await button.click();
      await expect(menu).toBeVisible();
      await button.click();
      await expect(menu).toBeHidden();
    });
    await step("Account opens the account page and closes the menu", async () => {
      await button.click();
      await menu.getByRole("link", { name: "Account" }).click();
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
      await expect(menu).toBeHidden();
    });
  },
);

test(
  "an admin who is not root sees the same pages, with root-only actions left out",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "Every sidebar link is there for an admin. The difference is inside two pages: Admins explains that only root can add or remove admins and has no Add admin button, and Signing keys has no Rotate button. Root sees both.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await openAs(page, sam, "/users");
    await step("All seven links are in the sidebar", async () => {
      for (const target of PAGES) {
        await expect(nav(page, target.link)).toBeVisible();
      }
    });
    await step("Admins has no Add admin button and says why", async () => {
      await nav(page, "Admins").click();
      await expect(page.getByText("Only root can add, turn off, or remove admins.")).toBeVisible();
      await expect(page.getByTestId("new-admin")).toBeHidden();
    });
    await step("Signing keys has no Rotate button", async () => {
      await nav(page, "Signing keys").click();
      await expect(page.getByRole("heading", { name: "Signing keys", level: 1 })).toBeVisible();
      await expect(page.getByTestId("rotate-key")).toBeHidden();
    });
    await step("Root gets both", async () => {
      await openAs(page, await app.root(), "/admins");
      await expect(page.getByTestId("new-admin")).toBeVisible();
      await expect(page.getByText("Only root can add, turn off, or remove admins.")).toBeHidden();
      await nav(page, "Signing keys").click();
      await expect(page.getByTestId("rotate-key")).toBeVisible();
    });
  },
);

test(
  "on a phone the sidebar folds into a top bar and a sheet",
  {
    tag: "@console",
    annotation: about(
      "At 390 pixels wide the sidebar is gone. A top bar with the Dopgate lockup and a menu button replaces it, and the button opens the same navigation and account menu in a sheet. Choosing a page closes the sheet, and Escape does too.",
    ),
  },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const sam = await app.admin("sam");
    await openAs(page, sam, "/users");
    const open = page.getByTestId("nav-open");
    const sheet = page.getByRole("dialog", { name: "Dopgate" });
    await step("The top bar shows a menu button and no sidebar", async () => {
      await expect(open).toBeVisible();
      await expect(open).toHaveAttribute("aria-label", "Open navigation");
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
      await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    });
    await step("The button opens the navigation in a sheet", async () => {
      await open.click();
      await expect(sheet).toBeVisible();
      for (const target of PAGES) {
        await expect(nav(page, target.link)).toBeVisible();
      }
      await expect(nav(page, "Users")).toHaveAttribute("aria-current", "page");
      await expect(sheet.getByTestId("account-menu-button")).toContainText(sam.email);
    });
    await step("A link opens its page and the sheet closes", async () => {
      await nav(page, "Signing keys").click();
      await expect(page).toHaveURL(/\/keys$/);
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("heading", { name: "Signing keys", level: 1 })).toBeVisible();
    });
    await step("Escape closes the sheet", async () => {
      await open.click();
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    });
    await step("The account menu in the sheet leads to Account", async () => {
      await open.click();
      await sheet.getByTestId("account-menu-button").click();
      await sheet.getByTestId("account-menu").getByRole("link", { name: "Account" }).click();
      await expect(page).toHaveURL(/\/account$/);
      await expect(sheet).toBeHidden();
    });
    await step("A wide window brings the sidebar back", async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(open).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    });
  },
);

test(
  "ending the session behind the page's back shows Session expired",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "The admin's console sessions are ended through the API while the page is open. The next thing the page asks for fails, and a modal that cannot be dismissed says the session expired. Sign in again leads to sign-in and keeps the page that was open.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await openAs(page, sam, "/users");
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    await step("End every console session of the admin through the API", async () => {
      const ended = await sam.api.delete("/console/sessions", undefined, { record: false });
      expect(ended.ok).toBe(true);
    });
    await step("Open another page, which asks the server for data", async () => {
      await nav(page, "Settings").click();
    });
    const dialog = page.getByRole("dialog", { name: "Session expired" });
    await step("The Session expired dialog appears and has no close button", async () => {
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Your session has expired. Sign in again to continue.")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close dialog" })).toHaveCount(0);
    });
    await step("Escape does not dismiss it", async () => {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
    });
    await step("Sign in again leads to sign-in and remembers the page", async () => {
      await dialog.getByRole("button", { name: "Sign in again" }).click();
      await expect(page).toHaveURL(/\/sign-in\?redirect=(%2F|\/)settings$/);
      await expect(dialog).toBeHidden();
    });
  },
);
