import { about, COOKIE_MODE, expect, PASSWORD, step, test, useServer } from "../harness/index.ts";
import { enterCode, openAs } from "../harness/helpers.ts";

const app = useServer();

const NEW_PASSWORD = "a brand new passphrase";

/** The password card of the account page. */
const passwordForm = (page: import("@playwright/test").Page) => page.getByTestId("password-form");
/** The Email card of the account page. */
const emailCard = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Email" });
/** The Sessions card of the account page. */
const sessionsCard = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Sessions" });

test(
  "the profile shows the admin and the display name saves and persists",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "The Account page names the signed-in admin and their role. Save stays off until the display name changes. After saving, Saved shows and the name is still there after a reload. Emptying the field removes the name.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam", { displayName: "Sam Before" });
    await openAs(page, sam, "/account");
    const save = page.getByRole("button", { name: "Save", exact: true });
    const name = page.getByLabel("Display name");
    await step("The header shows the email and role, the field the current name", async () => {
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
      await expect(page.getByText("Your own sign-in details.")).toBeVisible();
      await expect(page.getByRole("main").getByText(sam.email).first()).toBeVisible();
      await expect(name).toHaveValue("Sam Before");
      await expect(save).toBeDisabled();
    });
    await step("Change the name and save it", async () => {
      await name.fill("Sam After");
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("The server has the new name", async () => {
      const me = await sam.api.get("/console/me", { record: false });
      expect(me.data.displayName).toBe("Sam After");
    });
    await step("A reload shows it again", async () => {
      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue("Sam After");
    });
    await step("Emptying the field and saving removes the name", async () => {
      await page.getByLabel("Display name").fill("");
      await save.click();
      await expect(save).toBeDisabled();
      const me = await sam.api.get("/console/me", { record: false });
      expect(me.data.displayName).toBeNull();
      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue("");
    });
  },
);

test(
  "changing the password checks the form, the current password and the new rules",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "Empty fields and a confirmation that differs are caught in the page. A wrong current password and a new password that breaks the length rule come back from the server, each under its own field. Nothing changes: the old password still signs in.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await openAs(page, sam, "/account");
    const form = passwordForm(page);
    const submit = form.getByRole("button", { name: "Change password" });
    await step("Submit the empty form", async () => {
      await submit.click();
      await expect(form.getByText("Enter your current password.")).toBeVisible();
      await expect(form.getByText("Choose a new password.")).toBeVisible();
    });
    await step("A confirmation that differs", async () => {
      await form.getByLabel("Current password").fill(PASSWORD);
      await form.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await form.getByLabel("Confirm new password").fill(`${NEW_PASSWORD}!`);
      await submit.click();
      await expect(form.getByText("The passwords don't match.")).toBeVisible();
    });
    await step("A wrong current password comes back from the server", async () => {
      await form.getByLabel("Confirm new password").fill(NEW_PASSWORD);
      await form.getByLabel("Current password").fill("not my password");
      await submit.click();
      await expect(form.getByText("This isn't your current password.")).toBeVisible();
      await expect(form.getByText("Password changed.")).toBeHidden();
    });
    await step("A new password under eight characters is refused by the server", async () => {
      await form.getByLabel("Current password").fill(PASSWORD);
      await form.getByLabel("New password", { exact: true }).fill("short");
      await form.getByLabel("Confirm new password").fill("short");
      await submit.click();
      await expect(form.getByText("Use at least 8 characters.")).toBeVisible();
    });
    await step("The old password still signs in", async () => {
      const again = await app.consoleSession(sam.email, PASSWORD);
      expect(again.email).toBe(sam.email);
    });
  },
);

test(
  "a password change works for the next sign-in and ends the other sessions",
  {
    tag: ["@console", "@auth", "@security"],
    annotation: about(
      "With the current password given, the new one is saved and the form clears. The browser stays signed in. A session open elsewhere ends, the old password stops working, and a fresh sign-in with the new one succeeds.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    const elsewhere = await app.consoleSession(sam.email);
    await openAs(page, sam, "/account");
    const form = passwordForm(page);
    await step("Fill in the current and new password and submit", async () => {
      await form.getByLabel("Current password").fill(PASSWORD);
      await form.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await form.getByLabel("Confirm new password").fill(NEW_PASSWORD);
      await form.getByRole("button", { name: "Change password" }).click();
      await expect(form.getByText("Password changed.")).toBeVisible();
      await expect(form.getByLabel("Current password")).toHaveValue("");
    });
    await step("The session on this browser is still good", async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
      await expect(page).toHaveURL(/\/account$/);
    });
    await step("The session open elsewhere has ended", async () => {
      await expect.poll(async () => (await elsewhere.api.get("/console/me", { record: false })).status).toBe(401);
    });
    await step("The old password is refused and the new one signs in", async () => {
      const api = await app.newApi("old password");
      const old = await api.signIn("/console/login", sam.email, PASSWORD, { record: false });
      expect(old.status).toBe(401);
      const fresh = await app.consoleSession(sam.email, NEW_PASSWORD);
      expect(fresh.email).toBe(sam.email);
    });
  },
);

test(
  "an admin with no password sets one with an emailed code",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "An admin who signs in with codes has no current password to give. The Password card explains that and offers a code instead. The code goes to their address, setting a password with it works, and the card then asks for a current password like any other.",
    ),
  },
  async ({ page }) => {
    const email = app.email("codey");
    await step("Root adds an admin with no password", async () => {
      const root = await app.root();
      await root.api.must("POST", "/admin/admins", { email }, { record: false });
    });
    await step("The admin signs in with a code", async () => {
      const sent = await page.request.post("/api/v1/console/codes/send", { data: { email } });
      expect(sent.ok()).toBe(true);
      const confirmed = await page.request.post("/api/v1/console/codes/confirm", {
        headers: COOKIE_MODE,
        data: { email, purpose: "login", code: await app.mail.code(email) },
      });
      expect(confirmed.status()).toBe(200);
      await page.goto("/account");
    });
    const form = passwordForm(page);
    const codeArea = page.getByTestId("password-code");
    await step("The card asks for a code and not a current password", async () => {
      await expect(codeArea).toBeVisible();
      await expect(codeArea).toContainText("Your account has no password yet.");
      await expect(codeArea).toContainText(email);
      await expect(form.getByLabel("Current password")).toHaveCount(0);
      await expect(form.getByRole("button", { name: "Set password" })).toBeVisible();
    });
    await step("Set password without a code is refused in the page", async () => {
      await form.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await form.getByLabel("Confirm new password").fill(NEW_PASSWORD);
      await form.getByRole("button", { name: "Set password" }).click();
      await expect(form.getByText("Enter the 6-digit code we emailed you.")).toBeVisible();
    });
    await step("Email me a code sends one to the admin", async () => {
      const before = await app.mail.count(email);
      await codeArea.getByRole("button", { name: "Email me a code" }).click();
      await app.mail.last(email, { after: before });
      await expect(codeArea.getByRole("button", { name: "Send a new code" })).toBeVisible();
    });
    await step("A wrong code is refused", async () => {
      const real = await app.mail.code(email);
      await enterCode(page, real.slice(0, 5) + (real.endsWith("0") ? "1" : "0"));
      await form.getByRole("button", { name: "Set password" }).click();
      await expect(codeArea.getByRole("alert")).toBeVisible();
      await expect(form.getByText("Password changed.")).toBeHidden();
    });
    await step("The right code sets the password", async () => {
      await enterCode(page, await app.mail.code(email));
      await form.getByRole("button", { name: "Set password" }).click();
      await expect(form.getByText("Password changed.")).toBeVisible();
    });
    await step("The card now asks for a current password", async () => {
      await expect(form.getByLabel("Current password")).toBeVisible();
      await expect(form.getByRole("button", { name: "Change password" })).toBeVisible();
      await expect(page.getByTestId("password-code")).toHaveCount(0);
    });
    await step("The new password signs in to the console", async () => {
      const again = await app.consoleSession(email, NEW_PASSWORD);
      expect(again.email).toBe(email);
    });
  },
);

test(
  "changing the email sends a code to the new address and the code confirms it",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "The form asks for the new address and the current password. A code goes to the new address, and entering it changes the email. The page shows the new address, the old one stops signing in, and the new one signs in with the same password.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    const next = app.email("sam-new");
    await openAs(page, sam, "/account");
    const card = emailCard(page);
    await step("Send a code to the new address", async () => {
      await card.getByLabel("New email").fill(next);
      await card.getByLabel("Current password").fill(PASSWORD);
      await card.getByRole("button", { name: "Send code" }).click();
      await expect(page.getByTestId("email-code-form")).toBeVisible();
      await expect(page.getByTestId("email-code-form")).toContainText(next);
    });
    await step("The code went to the new address only", async () => {
      expect(await app.mail.code(next)).toMatch(/^\d{6}$/);
    });
    await step("A wrong code is refused and the form stays", async () => {
      const real = await app.mail.code(next);
      await enterCode(page, real.slice(0, 5) + (real.endsWith("0") ? "1" : "0"));
      await expect(page.getByTestId("email-code-form").getByRole("alert")).toBeVisible();
      await expect(page.getByTestId("email-code-form")).toBeVisible();
    });
    await step("The right code changes the email", async () => {
      await enterCode(page, await app.mail.code(next));
      await expect(page.getByText("Email changed.")).toBeVisible();
      await expect(page.getByTestId("email-code-form")).toHaveCount(0);
      await expect(page.getByRole("main").getByText(next).first()).toBeVisible();
    });
    await step("The menu shows the new address after a reload", async () => {
      await page.reload();
      await expect(page.getByTestId("account-menu-button")).toContainText(next);
    });
    await step("The old address no longer signs in and the new one does", async () => {
      const api = await app.newApi("old email");
      const old = await api.signIn("/console/login", sam.email, PASSWORD, { record: false });
      expect(old.status).toBe(401);
      const fresh = await app.consoleSession(next, PASSWORD);
      expect(fresh.id).toBe(sam.id);
    });
  },
);

test(
  "the email form refuses bad input and can be cancelled",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "A malformed address, the address already in use, an address another admin has and a wrong current password each stop the change with a message. Cancel on the code step goes back to the form.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    const other = await app.admin("other");
    await openAs(page, sam, "/account");
    const card = emailCard(page);
    const send = card.getByRole("button", { name: "Send code" });
    await step("A malformed address", async () => {
      await card.getByLabel("New email").fill("nope");
      await send.click();
      await expect(card.getByText("Enter a valid email address.")).toBeVisible();
    });
    await step("The address they already have", async () => {
      await card.getByLabel("New email").fill(sam.email.toUpperCase());
      await send.click();
      await expect(card.getByText("This is already your email address.")).toBeVisible();
    });
    await step("A good address with no password", async () => {
      await card.getByLabel("New email").fill(app.email("fresh"));
      await send.click();
      await expect(card.getByText("Enter your current password.")).toBeVisible();
    });
    await step("A wrong current password", async () => {
      await card.getByLabel("Current password").fill("not my password");
      await send.click();
      await expect(page.getByTestId("email-code-form")).toHaveCount(0);
      await expect(card.getByLabel("Current password")).toHaveAttribute("aria-invalid", "true");
    });
    await step("An address another admin already has", async () => {
      await card.getByLabel("New email").fill(other.email);
      await card.getByLabel("Current password").fill(PASSWORD);
      await send.click();
      await expect(card.getByText("Another account already uses this email.")).toBeVisible();
    });
    await step("Cancel on the code step returns to the form", async () => {
      await card.getByLabel("New email").fill(app.email("later"));
      await send.click();
      await expect(page.getByTestId("email-code-form")).toBeVisible();
      await page.getByTestId("email-code-form").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByTestId("email-code-form")).toHaveCount(0);
      await expect(card.getByLabel("New email")).toBeVisible();
    });
  },
);

test(
  "the sessions list marks this browser and signs out another session",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "The list opens with one session, marked This browser, and no sign-out button for it. A second session opened through the API shows up after a reload. Sign out on its row ends it, and the row goes away.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    await step("End the session the test itself holds, so only the browser's is left", async () => {
      const out = await sam.api.post("/console/logout", { refreshToken: sam.tokens.refreshToken }, { record: false });
      expect(out.ok).toBe(true);
    });
    await openAs(page, sam, "/account");
    const card = sessionsCard(page);
    await step("Only this browser is listed", async () => {
      await expect(card.getByText("This browser")).toHaveCount(1);
      await expect(card.getByRole("listitem")).toHaveCount(1);
      await expect(card.getByText(/Chrome on /)).toBeVisible();
      await expect(card.getByText(/Password/).first()).toBeVisible();
      await expect(page.getByTestId("sign-out-others")).toHaveCount(0);
    });
    const other = await app.consoleSession(sam.email);
    await step("Another session appears after a reload, with its own button", async () => {
      await page.reload();
      await expect(card.getByRole("listitem")).toHaveCount(2);
      await expect(card.getByText("This browser")).toHaveCount(1);
      await expect(page.getByTestId("sign-out-others")).toBeVisible();
    });
    await step("Sign out on that row ends it", async () => {
      await card.getByRole("listitem").filter({ hasNotText: "This browser" }).getByRole("button", { name: "Sign out" }).click();
      await expect(card.getByRole("listitem")).toHaveCount(1);
      await expect(page.getByTestId("sign-out-others")).toHaveCount(0);
      await expect.poll(async () => (await other.api.get("/console/me", { record: false })).status).toBe(401);
    });
  },
);

test(
  "Sign out other sessions ends every session but this browser's",
  {
    tag: ["@console", "@auth", "@security"],
    annotation: about(
      "Three other sessions are open, counting the one the test holds. One click on Sign out other sessions ends all three, leaves this browser signed in and shows a single row.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    const second = await app.consoleSession(sam.email);
    const third = await app.consoleSession(sam.email);
    await openAs(page, sam, "/account");
    const card = sessionsCard(page);
    await step("The browser and three other sessions are listed", async () => {
      await expect(card.getByRole("listitem")).toHaveCount(4);
    });
    await step("Sign out other sessions", async () => {
      await page.getByTestId("sign-out-others").click();
      await expect(card.getByRole("listitem")).toHaveCount(1);
      await expect(card.getByText("This browser")).toBeVisible();
      await expect(page.getByTestId("sign-out-others")).toHaveCount(0);
    });
    await step("The others are signed out and this one is not", async () => {
      await expect.poll(async () => (await second.api.get("/console/me", { record: false })).status).toBe(401);
      await expect.poll(async () => (await third.api.get("/console/me", { record: false })).status).toBe(401);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
    });
  },
);
