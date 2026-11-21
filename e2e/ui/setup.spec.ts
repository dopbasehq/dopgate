import { about, expect, PASSWORD, step, test, useServer } from "../harness/index.ts";
import { signInOnPage } from "../harness/helpers.ts";

// No root yet, and the default limits: the wrong-token limit is part of the page's story.
const app = useServer({ root: false, serviceKey: false, relaxLimits: false });

const ROOT = "founder@dopbase.com";

test(
  "every address leads to the setup page until root exists",
  {
    tag: ["@setup", "@smoke"],
    annotation: about(
      "On a server with no root account the console has nothing to sign in to. The home page, the sign-in page, a user page, the account page and an unknown address all land on /setup.",
    ),
  },
  async ({ page }) => {
    for (const path of ["/", "/sign-in", "/users", "/users/usr_missing", "/account", "/no-such-page"]) {
      await step(`Open ${path}`, async () => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/setup$/);
        await expect(page.getByRole("heading", { name: "Set up Dopgate" })).toBeVisible();
      });
    }
    await step("The form asks for the token, email, password and confirmation", async () => {
      const form = page.getByTestId("setup-form");
      await expect(form.getByLabel("Setup token")).toBeVisible();
      await expect(form.getByLabel("Email")).toBeVisible();
      await expect(form.getByLabel("Password", { exact: true })).toBeVisible();
      await expect(form.getByLabel("Confirm password")).toBeVisible();
      await expect(
        form.getByRole("button", { name: "Create root account" }),
      ).toBeVisible();
    });
  },
);

test(
  "the setup form checks itself before it asks the server",
  {
    tag: "@setup",
    annotation: about(
      "Empty fields, a malformed email and a confirmation that differs from the password are caught in the page, with a message under each field. The server's own rule for short passwords shows under the password field.",
    ),
  },
  async ({ page }) => {
    const form = page.getByTestId("setup-form");
    const create = form.getByRole("button", { name: "Create root account" });
    await page.goto("/setup");
    await step("Submit an empty form", async () => {
      await create.click();
      await expect(form.getByText("Enter the setup token from the server log.")).toBeVisible();
      await expect(form.getByText("Enter your email address.")).toBeVisible();
      await expect(form.getByText("Choose a password.")).toBeVisible();
      await expect(page).toHaveURL(/\/setup$/);
    });
    await step("A malformed email is refused", async () => {
      await form.getByLabel("Setup token").fill("setup_anything");
      await form.getByLabel("Email").fill("not-an-email");
      await create.click();
      await expect(form.getByText("Enter a valid email address.")).toBeVisible();
    });
    await step("A different confirmation is refused", async () => {
      await form.getByLabel("Email").fill(ROOT);
      await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await form.getByLabel("Confirm password").fill(`${PASSWORD}x`);
      await create.click();
      await expect(form.getByText("The passwords don't match.")).toBeVisible();
      await expect(form.getByText("Enter a valid email address.")).toBeHidden();
    });
    await step("A password under eight characters comes back from the server", async () => {
      await form.getByLabel("Setup token").fill(await app.server.setupToken());
      await form.getByLabel("Password", { exact: true }).fill("short");
      await form.getByLabel("Confirm password").fill("short");
      await create.click();
      await expect(form.getByText("Use at least 8 characters.")).toBeVisible();
      await expect(page).toHaveURL(/\/setup$/);
    });
  },
);

test(
  "a wrong setup token shows the server's message under the token field",
  {
    tag: ["@setup", "@security"],
    annotation: about(
      "A token that is not the one in the log is refused and nothing is created. The page points at the log for the current one.",
    ),
  },
  async ({ page }) => {
    await page.goto("/setup");
    const form = page.getByTestId("setup-form");
    await step("Submit a made-up token with otherwise valid details", async () => {
      await form.getByLabel("Setup token").fill("setup_not-the-real-one");
      await form.getByLabel("Email").fill(ROOT);
      await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await form.getByLabel("Confirm password").fill(PASSWORD);
      await form.getByRole("button", { name: "Create root account" }).click();
    });
    await step("The token field explains it and the page stays", async () => {
      await expect(
        form.getByText("This setup token is wrong or has expired. Check the server log for the current one."),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/setup$/);
    });
    await step("The server still has no root", async () => {
      const status = await app.api.get("/bootstrap/status", { record: false });
      expect(status.data.initialized).toBe(false);
    });
  },
);

test(
  "the right token creates root, signs in, and closes the setup page",
  {
    tag: ["@setup", "@smoke"],
    annotation: about(
      "Creating the root account signs the new admin straight in on the Users page. Signing out and in again works with the same password. A second browser that still shows the form learns the server is already set up, and /setup now redirects to sign-in.",
    ),
  },
  async ({ page, newContext }) => {
    const lateContext = await newContext("second browser", { baseURL: app.url });
    const late = await lateContext.newPage();
    await step("A second browser opens the setup form and fills it in", async () => {
      await late.goto("/setup");
      const form = late.getByTestId("setup-form");
      await form.getByLabel("Setup token").fill(await app.server.setupToken());
      await form.getByLabel("Email").fill("late@dopbase.com");
      await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await form.getByLabel("Confirm password").fill(PASSWORD);
    });
    await step("Fill the form with the token from the log and submit", async () => {
      await page.goto("/setup");
      const form = page.getByTestId("setup-form");
      await form.getByLabel("Setup token").fill(await app.server.setupToken());
      await form.getByLabel("Email").fill(ROOT);
      await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await form.getByLabel("Confirm password").fill(PASSWORD);
      await form.getByRole("button", { name: "Create root account" }).click();
    });
    await step("Root lands on Users with its own email and role in the menu", async () => {
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
      const menu = page.getByTestId("account-menu-button");
      await expect(menu).toContainText(ROOT);
      await expect(menu).toContainText("Root");
    });
    await step("The server says it is set up", async () => {
      const status = await app.api.get("/bootstrap/status", { record: false });
      expect(status.data.initialized).toBe(true);
    });
    await step("The second browser submits and is told the server is already set up", async () => {
      await late.getByTestId("setup-form").getByRole("button", { name: "Create root account" }).click();
      await expect(late.getByText("This server is already set up")).toBeVisible();
      await expect(late.getByText("Someone created the root account while this page was open.")).toBeVisible();
      await late.getByRole("link", { name: "Sign in" }).click();
      await expect(late).toHaveURL(/\/sign-in$/);
    });
    await step("Sign out, then sign in with the new account", async () => {
      await page.getByTestId("account-menu-button").click();
      await page.getByTestId("sign-out-button").click();
      await expect(page).toHaveURL(/\/sign-in$/);
      await signInOnPage(page, ROOT, PASSWORD);
      await expect(page).toHaveURL(/\/users$/);
    });
    await step("/setup now redirects to sign-in for a visitor", async () => {
      await late.goto("/setup");
      await expect(late).toHaveURL(/\/sign-in$/);
      await expect(late.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
    await step("And for the signed-in admin", async () => {
      await page.goto("/setup");
      await expect(page).toHaveURL(/\/users$/);
    });
  },
);
