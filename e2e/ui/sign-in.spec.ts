import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { enterCode, nav, signInOnPage, signOutOnPage } from "../harness/helpers.ts";

const app = useServer();

/** The code with its last digit changed, so it is certainly wrong. */
function wrongCode(code: string): string {
  return code.slice(0, 5) + (code.endsWith("0") ? "1" : "0");
}

test(
  "a visitor at the home page lands on the sign-in form",
  {
    tag: ["@console", "@smoke"],
    annotation: about(
      "Nobody is signed in, so the console's front door is the sign-in page: an email and password form with an option to get a code by email. The home page is a redirect to Users, so sign-in keeps ?redirect=/users and returns there.",
    ),
  },
  async ({ page }) => {
    await step("Open the home page", async () => {
      await page.goto("/");
      // The home page is a redirect to Users, so that is the address kept.
      await expect(page).toHaveURL(/\/sign-in\?redirect=(%2F|\/)users$/);
    });
    await step("The form offers a password and an emailed code", async () => {
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await expect(page.getByText("Admin Console")).toBeVisible();
      const form = page.getByTestId("sign-in-form");
      await expect(form.getByLabel("Email")).toBeVisible();
      await expect(form.getByLabel("Password", { exact: true })).toBeVisible();
      await expect(form.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(form.getByRole("button", { name: "Email me a code" })).toBeVisible();
    });
  },
);

test(
  "root signs in with a password and the session survives a reload",
  {
    tag: ["@console", "@smoke", "@auth"],
    annotation: about(
      "Root signs in on the sign-in page and lands on Users. The account menu shows the email and the Root role. A reload keeps the session through the refresh cookie, and the sign-in page is closed to someone who is already in.",
    ),
  },
  async ({ page }) => {
    await step("Sign in as root", async () => {
      await page.goto("/sign-in");
      await signInOnPage(page, ROOT_EMAIL, PASSWORD);
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    });
    await step("The account menu shows the email and Root", async () => {
      const menu = page.getByTestId("account-menu-button");
      await expect(menu).toContainText(ROOT_EMAIL);
      await expect(menu).toContainText("Root");
    });
    await step("The browser holds the console refresh cookie", async () => {
      const cookies = await page.context().cookies();
      const cookie = cookies.find((c) => c.name === "dopgate_console");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.path).toBe("/api/v1/console");
    });
    await step("Reload the page and stay signed in", async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByTestId("account-menu-button")).toContainText(ROOT_EMAIL);
    });
    await step("The sign-in page sends a signed-in admin to Users", async () => {
      await page.goto("/sign-in");
      await expect(page).toHaveURL(/\/users$/);
    });
  },
);

test(
  "an admin who is not root shows the Admin role in the menu",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "Root adds an admin. That admin signs in on the same page and the account menu says Admin instead of Root.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await step("Sign in as the admin", async () => {
      await page.goto("/sign-in");
      await signInOnPage(page, sam.email);
      await expect(page).toHaveURL(/\/users$/);
    });
    await step("The menu says Admin", async () => {
      const menu = page.getByTestId("account-menu-button");
      await expect(menu).toContainText(sam.email);
      await expect(menu).toContainText("Admin");
      await expect(menu).not.toContainText("Root");
    });
  },
);

test(
  "signing out sends every page to sign-in, and signing in returns to the page asked for",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "After Sign out in the account menu, a deep link goes to /sign-in with the address kept in ?redirect=. Signing in there opens that page and not the default one. An address that leaves the site is ignored.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await step("Sign in and sign out from the account menu", async () => {
      await page.goto("/sign-in");
      await signInOnPage(page, sam.email);
      await expect(page).toHaveURL(/\/users$/);
      await signOutOnPage(page);
    });
    await step("A protected page now redirects and keeps its address", async () => {
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/sign-in\?redirect=(%2F|\/)settings$/);
    });
    await step("A reload does not bring the session back", async () => {
      await page.goto("/users");
      await expect(page).toHaveURL(/\/sign-in\?redirect=(%2F|\/)users$/);
    });
    await step("Signing in opens the page that was asked for", async () => {
      await page.goto("/keys");
      await signInOnPage(page, sam.email);
      await expect(page).toHaveURL(/\/keys$/);
      await expect(nav(page, "Signing keys")).toHaveAttribute("aria-current", "page");
    });
    await step("Sign out again and try a redirect to another site", async () => {
      await signOutOnPage(page);
      await page.goto("/sign-in?redirect=//example.com/phish");
      await signInOnPage(page, sam.email);
      await expect(page).toHaveURL(/\/users$/);
    });
  },
);

test(
  "the sign-in form checks empty and malformed input before asking the server",
  {
    tag: "@console",
    annotation: about(
      "An empty form, an email that is not an address and a missing password each get a message under the field. Nothing is sent, so no problem alert shows.",
    ),
  },
  async ({ page }) => {
    await page.goto("/sign-in");
    const form = page.getByTestId("sign-in-form");
    const submit = form.getByRole("button", { name: "Sign in", exact: true });
    await step("Submit with nothing filled in", async () => {
      await submit.click();
      await expect(form.getByText("Enter your email address.")).toBeVisible();
    });
    await step("An email that is not an address", async () => {
      await form.getByLabel("Email").fill("not-an-email");
      await submit.click();
      await expect(form.getByText("Enter a valid email address.")).toBeVisible();
    });
    await step("A good email without a password", async () => {
      await form.getByLabel("Email").fill(ROOT_EMAIL);
      await submit.click();
      await expect(form.getByText("Enter your password.")).toBeVisible();
      await expect(page.getByTestId("sign-in-problem")).toBeHidden();
    });
    await step("Emailing a code needs a valid address too", async () => {
      await form.getByLabel("Email").fill("");
      await form.getByRole("button", { name: "Email me a code" }).click();
      await expect(form.getByText("Enter your email address.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
  },
);

test(
  "a wrong password shows the problem alert and stays on the form",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "A password that does not match gets the same plain answer an unknown email would: the email or password is wrong. The form stays and the typed email is kept.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await page.goto("/sign-in");
    await step("Sign in with the wrong password", async () => {
      await signInOnPage(page, sam.email, "not the password");
    });
    await step("The alert says the email or password is wrong", async () => {
      const problem = page.getByTestId("sign-in-problem");
      await expect(problem).toContainText("Couldn't sign you in");
      await expect(problem).toContainText("The email or password is wrong.");
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByTestId("sign-in-form").getByLabel("Email")).toHaveValue(sam.email);
    });
    await step("An unknown email gets the same answer", async () => {
      await signInOnPage(page, app.email("nobody"), PASSWORD);
      await expect(page.getByTestId("sign-in-problem")).toContainText("The email or password is wrong.");
    });
  },
);

test(
  "a user of the app cannot sign in to the console",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "The console only knows admin accounts. A user's correct email and password get the same answer as a wrong password, so the page does not reveal that the account exists.",
    ),
  },
  async ({ page }) => {
    const ana = await app.user("ana");
    await page.goto("/sign-in");
    await step("Sign in with a user's own email and password", async () => {
      await signInOnPage(page, ana.email, ana.password!);
    });
    await step("The alert says the email or password is wrong", async () => {
      await expect(page.getByTestId("sign-in-problem")).toContainText("The email or password is wrong.");
      await expect(page).toHaveURL(/\/sign-in$/);
    });
    await step("No code goes to a user either, but the page still moves on", async () => {
      const before = await app.mail.count(ana.email);
      await page.getByTestId("sign-in-form").getByRole("button", { name: "Email me a code" }).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await expect(page.getByText(`If ${ana.email} belongs to an admin, a code is on its way.`)).toBeVisible();
      expect(await app.mail.count(ana.email)).toBe(before);
    });
  },
);

test(
  "a turned-off admin is told the account is off",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "Root turns an admin off. Their correct password no longer signs in, and the alert says so and who can fix it.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await step("Root turns the admin off", async () => {
      const root = await app.root();
      await root.api.must("POST", `/admin/admins/${sam.id}/disable`, undefined, { record: false });
    });
    await step("Sign in with the right password", async () => {
      await page.goto("/sign-in");
      await signInOnPage(page, sam.email);
      const problem = page.getByTestId("sign-in-problem");
      await expect(problem).toContainText("This account is turned off");
      await expect(problem).toContainText("Ask another admin to turn it back on.");
    });
  },
);

test(
  "an emailed code signs an admin in",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "Email me a code moves to the code step and emails a 6-digit code to the admin. Typing it in signs in and opens Users. The last digit submits by itself.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await step("Ask for a code", async () => {
      await page.goto("/sign-in");
      const form = page.getByTestId("sign-in-form");
      await form.getByLabel("Email").fill(sam.email);
      await form.getByRole("button", { name: "Email me a code" }).click();
    });
    await step("The code step names the address", async () => {
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      const codeForm = page.getByTestId("code-form");
      await expect(codeForm.getByText(`If ${sam.email} belongs to an admin, a code is on its way.`)).toBeVisible();
      await expect(page.getByText("Enter the 6-digit code we sent to")).toContainText(sam.email);
    });
    await step("Enter the code from the email", async () => {
      await enterCode(page, await app.mail.code(sam.email));
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByTestId("account-menu-button")).toContainText(sam.email);
    });
  },
);

test(
  "a wrong code is refused and a new code works",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "A code that does not match shows an error under the boxes and clears them. Send a new code emails another message, and its code signs in. Use a password instead goes back to the password form.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await page.goto("/sign-in");
    const form = page.getByTestId("sign-in-form");
    await form.getByLabel("Email").fill(sam.email);
    await form.getByRole("button", { name: "Email me a code" }).click();
    const first = await app.mail.code(sam.email);
    await step("Enter a code that is wrong", async () => {
      await enterCode(page, wrongCode(first));
      await expect(page.getByTestId("code-form").getByRole("alert")).toBeVisible();
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByTestId("code-box-0")).toHaveValue("");
    });
    await step("Send a new code", async () => {
      const before = await app.mail.count(sam.email);
      await page.getByRole("button", { name: "Send a new code" }).click();
      await app.mail.last(sam.email, { after: before });
      expect(await app.mail.count(sam.email)).toBe(before + 1);
    });
    await step("Use a password instead returns to the password form", async () => {
      await page.getByRole("button", { name: "Use a password instead" }).click();
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await expect(page.getByTestId("sign-in-form").getByLabel("Email")).toHaveValue(sam.email);
    });
    await step("Ask again and sign in with the newest code", async () => {
      const before = await app.mail.count(sam.email);
      await page.getByTestId("sign-in-form").getByRole("button", { name: "Email me a code" }).click();
      await enterCode(page, await app.mail.code(sam.email, { after: before }));
      await expect(page).toHaveURL(/\/users$/);
    });
  },
);

test(
  "asking for codes too fast shows the wait",
  {
    tag: ["@console", "@limits"],
    annotation: about(
      "With a 60 second wait between codes, a second request right away is refused. The page says too many attempts and how long to wait. The setting is put back at the end.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await app.settings("limits", { codeResendSeconds: 60 });
    try {
      await page.goto("/sign-in");
      const form = page.getByTestId("sign-in-form");
      await form.getByLabel("Email").fill(sam.email);
      await step("The first code goes out", async () => {
        await form.getByRole("button", { name: "Email me a code" }).click();
        await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
        await app.mail.last(sam.email);
      });
      await step("A second request right away is refused with the wait", async () => {
        await page.getByRole("button", { name: "Send a new code" }).click();
        await expect(page.getByTestId("code-form").getByRole("alert")).toContainText(/Too many attempts\. Try again in \d+ seconds\./);
      });
    } finally {
      await app.settings("limits", { codeResendSeconds: 0 });
    }
  },
);
