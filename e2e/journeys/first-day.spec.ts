import {
  about,
  expect,
  PASSWORD,
  step,
  stepOn,
  test,
  useServer,
} from "../harness/index.ts";
import { nav, signInOnPage, signOutOnPage } from "../harness/helpers.ts";

// A server nobody has set up yet: no root account, only the setup token in
// its log.
const app = useServer({ root: false });

test(
  "first day: set the server up, add a teammate, let the backend create a user",
  {
    tag: ["@setup", "@admins"],
    annotation: about(
      "What an operator does the day Dopgate is installed: check that it answers, open the console, create the root account with the setup token from the log, add a second admin, and have the app's backend create its first user with the service key. The second admin then signs in from their own browser and sees the same user, but can't manage admins.",
    ),
  },
  async ({ page, newContext }) => {
    const rootEmail = app.email("owner");
    const teammate = app.email("sam");
    const customer = app.email("maya");

    await step("dopgate healthcheck says the server answers", async () => {
      await app
        .cliRaw(["healthcheck", "--port", String(app.server.port)])
        .ok();
    });
    await step("Open the console and get the setup page", async () => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/setup$/);
      await expect(
        page.getByRole("heading", { name: "Set up Dopgate" }),
      ).toBeVisible();
    });
    await step("Create the root account with the token from the log", async () => {
      const form = page.getByTestId("setup-form");
      await form.getByLabel("Setup token").fill(await app.server.setupToken());
      await form.getByLabel("Email").fill(rootEmail);
      await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await form.getByLabel("Confirm password").fill(PASSWORD);
      await form.getByRole("button", { name: "Create root account" }).click();
    });
    await step("Root is signed in and the users list is empty", async () => {
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByTestId("users-empty")).toHaveText("No users yet.");
      await expect(page.getByTestId("account-menu-button")).toContainText(
        rootEmail,
      );
    });
    await step("Add a second admin", async () => {
      await nav(page, "Admins").click();
      await page.getByTestId("new-admin").click();
      const dialog = page.getByRole("dialog", { name: "Add admin" });
      // The dialog moves focus to its first field a moment after it opens.
      await expect(dialog.getByLabel("Email")).toBeFocused();
      await dialog.getByLabel("Email").fill(teammate);
      await dialog.getByLabel("Display name").fill("Sam Rivera");
      await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await dialog.getByRole("button", { name: "Add admin" }).click();
      await expect(
        page.getByTestId("admin-row").filter({ hasText: teammate }),
      ).toContainText("Sam Rivera");
    });
    await step("The app's backend creates its first user with the service key", async () => {
      const created = await app.service.post("/admin/users", {
        email: customer,
        password: PASSWORD,
        displayName: "Maya Okafor",
        emailVerified: true,
      });
      expect(created.message).toBe("USER_CREATED");
    });
    await step("Reloaded, the console lists the user", async () => {
      await page.goto("/users");
      await expect(
        page.getByTestId("user-row").filter({ hasText: customer }),
      ).toContainText("Maya Okafor");
    });

    const context = await newContext("sam", { baseURL: app.url });
    const theirs = await context.newPage();
    await stepOn(theirs, "The second admin signs in from their own browser", async () => {
      await theirs.goto("/");
      await expect(theirs).toHaveURL(/\/sign-in\?redirect=\/users$/);
      await signInOnPage(theirs, teammate);
      await expect(theirs).toHaveURL(/\/users$/);
      await expect(
        theirs.getByTestId("user-row").filter({ hasText: customer }),
      ).toBeVisible();
    });
    await stepOn(theirs, "They can read the admins list but not change it", async () => {
      await nav(theirs, "Admins").click();
      await expect(
        theirs.getByText("Only root can add, turn off, or remove admins."),
      ).toBeVisible();
      await expect(theirs.getByTestId("new-admin")).toHaveCount(0);
      await expect(theirs.getByTestId("admin-row")).toHaveCount(2);
    });
    await step("The new user can sign in to the app", async () => {
      const signedIn = await app.api.post("/auth/login", {
        email: customer,
        password: PASSWORD,
      });
      expect(signedIn.message).toBe("SIGNED_IN");
    });
    await step("Root signs out", async () => {
      await signOutOnPage(page);
    });
  },
);
