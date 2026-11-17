import { about, expect, step, test, useServer } from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { plainUser, userRow } from "./people.support.ts";

const app = useServer();

/** What the service key reads from a user, for checking what the page saved. */
async function stored(id: string) {
  return app.service.must("GET", `/admin/users/${id}`, undefined, { record: false });
}

test(
  "the user page shows the profile and all three metadata objects",
  {
    tag: ["@console", "@users", "@smoke"],
    annotation: about(
      "A user made through the API with a name, public and private metadata, and a metadata object of their own opens on a page that shows each one: title, name, status badges, ID, dates, and every JSON object. The user's own metadata is read only.",
    ),
  },
  async ({ page }) => {
    const ana = await app.user("ana", {
      displayName: "Ana Moreno",
      publicMetadata: { plan: "pro" },
      privateMetadata: { billing: "cus_123" },
    });
    await ana.api.must("PATCH", "/auth/me", { userMetadata: { theme: "dark" } }, { record: false });
    await openAs(page, await app.root(), `/users/${ana.id}`);
    await step("The header shows the email, name and status", async () => {
      await expect(page.getByRole("heading", { name: ana.email, level: 1 })).toBeVisible();
      await expect(page.getByText("Ana Moreno", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
      await expect(page.getByText("Email verified")).toBeVisible();
      await expect(page.getByText("No password")).toHaveCount(0);
      await expect(page.getByText("Locked until")).toHaveCount(0);
    });
    await step("The breadcrumb names Users and this user", async () => {
      const crumbs = page.getByTestId("breadcrumb");
      await expect(crumbs.getByRole("link", { name: "Users" })).toBeVisible();
      await expect(crumbs.getByText(ana.email)).toBeVisible();
    });
    await step("The profile card has the ID and the display name field", async () => {
      const profile = page.getByRole("region", { name: "Profile" });
      await expect(profile.getByText(ana.id)).toBeVisible();
      await expect(profile.getByLabel("Display name")).toHaveValue("Ana Moreno");
      await expect(profile.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    await step("The three metadata objects show as JSON", async () => {
      await expect(page.getByLabel("Public metadata")).toHaveValue(JSON.stringify({ plan: "pro" }, null, 2));
      await expect(page.getByLabel("Private metadata")).toHaveValue(JSON.stringify({ billing: "cus_123" }, null, 2));
      const own = page.getByLabel("User metadata");
      await expect(own).toHaveValue(JSON.stringify({ theme: "dark" }, null, 2));
      await expect(own).toHaveJSProperty("readOnly", true);
    });
    await step("The breadcrumb leads back to Users, where the user is listed", async () => {
      await page.getByTestId("breadcrumb").getByRole("link", { name: "Users" }).click();
      await expect(page).toHaveURL(/\/users$/);
      await expect(userRow(page, ana.email)).toBeVisible();
    });
  },
);

test(
  "a user who signs in with codes and has not confirmed shows the matching badges",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "An account with no password and an unconfirmed email says so in two badges. Mark email verified in the Actions menu confirms it: the badge changes, a notice says so, the menu item goes away and the server agrees.",
    ),
  },
  async ({ page }) => {
    const leo = await app.user("leo", { password: false, verified: false });
    await openAs(page, await app.root(), `/users/${leo.id}`);
    await step("Both badges show", async () => {
      await expect(page.getByText("No password")).toBeVisible();
      await expect(page.getByText("Email not verified")).toBeVisible();
    });
    await step("Mark email verified from the Actions menu", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Mark email verified" }).click();
      await expect(page.getByText("Email marked as verified.")).toBeVisible();
      await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
      await expect(page.getByText("Email not verified")).toHaveCount(0);
    });
    await step("The menu no longer offers it", async () => {
      await page.getByTestId("user-actions").click();
      await expect(page.getByRole("menuitem", { name: "Send password reset code" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Mark email verified" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    });
    await step("The server has the flag set", async () => {
      expect((await stored(leo.id)).emailVerified).toBe(true);
    });
  },
);

test(
  "the display name saves and is there after a reload",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Save is off until the name changes. Saving shows a notice, the heading's subtitle follows, and the service key reads the new name. A reload shows it again. Emptying the field removes the name.",
    ),
  },
  async ({ page }) => {
    const pat = await plainUser(app, { displayName: "Pat Before" });
    await openAs(page, await app.root(), `/users/${pat.id}`);
    const name = page.getByLabel("Display name");
    const save = page.getByRole("region", { name: "Profile" }).getByRole("button", { name: "Save" });
    await step("Change the name and save", async () => {
      await expect(save).toBeDisabled();
      await name.fill("Pat After");
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByText("Profile saved.")).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("The server has it", async () => {
      expect((await stored(pat.id)).displayName).toBe("Pat After");
    });
    await step("A reload shows it in the field and under the title", async () => {
      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue("Pat After");
      await expect(page.getByText("Pat After", { exact: true }).first()).toBeVisible();
    });
    await step("Emptying the field and saving removes the name", async () => {
      await page.getByLabel("Display name").fill("");
      await save.click();
      await expect(page.getByText("Profile saved.")).toBeVisible();
      expect((await stored(pat.id)).displayName).toBeNull();
      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue("");
    });
  },
);

test(
  "public and private metadata save and persist",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Editing either JSON object turns Save metadata on. Saving replaces the whole object on the server, shows a notice and keeps the new text after a reload. Format tidies compact JSON.",
    ),
  },
  async ({ page }) => {
    const pat = await plainUser(app, { publicMetadata: { role: "viewer" }, privateMetadata: { note: "old" } });
    await openAs(page, await app.root(), `/users/${pat.id}`);
    const save = page.getByRole("button", { name: "Save metadata" });
    await expect(save).toBeDisabled();
    await step("Type new JSON into both editors and format one", async () => {
      await page.getByLabel("Public metadata").fill('{"role":"manager","seats":3}');
      await page.getByLabel("Private metadata").fill('{"note":"vip"}');
      await expect(save).toBeEnabled();
      // The public editor comes first, so its Format button is the first one.
      await page.getByRole("button", { name: "Format" }).first().click();
      await expect(page.getByLabel("Public metadata")).toHaveValue(JSON.stringify({ role: "manager", seats: 3 }, null, 2));
    });
    await step("Save metadata", async () => {
      await save.click();
      await expect(page.getByText("Metadata saved.")).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("The server replaced both objects", async () => {
      const user = await stored(pat.id);
      expect(user.publicMetadata).toEqual({ role: "manager", seats: 3 });
      expect(user.privateMetadata).toEqual({ note: "vip" });
    });
    await step("A reload shows them again", async () => {
      await page.reload();
      await expect(page.getByLabel("Public metadata")).toHaveValue(JSON.stringify({ role: "manager", seats: 3 }, null, 2));
      await expect(page.getByLabel("Private metadata")).toHaveValue(JSON.stringify({ note: "vip" }, null, 2));
    });
    await step("An emptied editor saves as an empty object", async () => {
      await page.getByLabel("Private metadata").fill("");
      await page.getByRole("button", { name: "Save metadata" }).click();
      await expect(page.getByText("Metadata saved.")).toBeVisible();
      expect((await stored(pat.id)).privateMetadata).toEqual({});
    });
  },
);

test(
  "invalid metadata is caught in the page and cannot be saved",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Text that is not JSON, JSON that is not an object, and public metadata over 1 KB each show a reason and keep Save metadata off. Nothing reaches the server.",
    ),
  },
  async ({ page }) => {
    const pat = await plainUser(app, { publicMetadata: { keep: true } });
    await openAs(page, await app.root(), `/users/${pat.id}`);
    const save = page.getByRole("button", { name: "Save metadata" });
    const publicEditor = page.getByLabel("Public metadata");
    await step("Broken JSON", async () => {
      await publicEditor.fill('{"role": ');
      await expect(page.getByText(/This is not valid JSON/)).toBeVisible();
      await expect(page.getByText("Fix the public metadata first.")).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("An array is not an object", async () => {
      await publicEditor.fill("[1, 2]");
      await expect(page.getByText("Metadata must be a JSON object, like {}.")).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("Private metadata is checked the same way", async () => {
      await publicEditor.fill('{"keep":true}');
      await page.getByLabel("Private metadata").fill("nope");
      await expect(page.getByText("Fix the private metadata first.")).toBeVisible();
      await expect(save).toBeDisabled();
      await page.getByLabel("Private metadata").fill("{}");
    });
    await step("Public metadata over 1 KB", async () => {
      await publicEditor.fill(JSON.stringify({ blob: "x".repeat(1100) }));
      await expect(page.getByText("Public metadata is over 1 KB. Shorten it first.")).toBeVisible();
      await expect(save).toBeDisabled();
    });
    await step("The server still has the old metadata", async () => {
      expect((await stored(pat.id)).publicMetadata).toEqual({ keep: true });
    });
  },
);

test(
  "turning an account off ends its sessions and turning it back on lets it in",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Turn off account asks first. Cancel does nothing. Confirming turns the badge to Disabled, says the sessions ended, and the user's refresh token stops working and sign-in is refused. Turn account back on restores Active and sign-in.",
    ),
  },
  async ({ page }) => {
    const ana = await app.user("ana");
    await openAs(page, await app.root(), `/users/${ana.id}`);
    const dialog = page.getByRole("dialog", { name: "Turn off this account?" });
    await step("Turn off account asks and Cancel leaves it active", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Turn off account" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`${ana.email} is signed out everywhere`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
    });
    await step("Confirm turning it off", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Turn off account" }).click();
      await dialog.getByRole("button", { name: "Turn off" }).click();
      await expect(page.getByText("Account turned off. Its sessions have ended.")).toBeVisible();
      await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toHaveCount(0);
    });
    await step("The user's refresh token and sign-in are refused", async () => {
      const refreshed = await app.api.post("/auth/refresh", { refreshToken: ana.tokens!.refreshToken }, { record: false });
      expect(refreshed.status).toBe(401);
      const api = await app.newApi("disabled");
      const attempt = await api.signIn("/auth/login", ana.email, ana.password!, { record: false });
      expect(attempt.code).toBe("ACCOUNT_DISABLED");
    });
    await step("The menu now offers turning it back on and no longer turning off", async () => {
      await page.getByTestId("user-actions").click();
      await expect(page.getByRole("menuitem", { name: "Turn off account" })).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Turn account back on" }).click();
      await expect(page.getByText("Account turned back on.")).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
    });
    await step("The user can sign in again", async () => {
      const session = await app.userSession(ana.email, ana.password);
      expect(session.tokens.accessToken).toBeTruthy();
    });
  },
);

test(
  "Send password reset code emails the user a code",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "From the Actions menu an admin sends the user a password reset code. A notice names the address, and an email with a 6-digit code reaches it.",
    ),
  },
  async ({ page }) => {
    const ana = await app.user("ana");
    await openAs(page, await app.root(), `/users/${ana.id}`);
    const before = await app.mail.count(ana.email);
    await step("Send password reset code", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Send password reset code" }).click();
      await expect(page.getByText(`Sent a password reset code to ${ana.email}.`)).toBeVisible();
    });
    await step("The email arrives with a code", async () => {
      const mail = await app.mail.last(ana.email, { after: before });
      expect(mail.to).toBe(ana.email);
      expect(await app.mail.code(ana.email, { after: before })).toMatch(/^\d{6}$/);
    });
    await step("The code resets the password", async () => {
      const code = await app.mail.code(ana.email);
      const reset = await app.api.post("/auth/password/reset", { email: ana.email, code, newPassword: app.value() }, { record: false });
      expect(reset.ok).toBe(true);
    });
  },
);

test(
  "deleting a user needs the email typed and returns to the list",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Delete user opens a dialog that asks for the user's email. The button stays off until the text matches exactly. Confirming deletes the account, opens the Users list without it, and the API no longer finds it.",
    ),
  },
  async ({ page }) => {
    const pat = await plainUser(app);
    await openAs(page, await app.root(), `/users/${pat.id}`);
    const dialog = page.getByRole("dialog", { name: "Delete this user?" });
    const confirm = dialog.getByRole("button", { name: "Delete user" });
    await step("Open the delete dialog", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Delete user" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Deletes ${pat.email} and ends their sessions.`);
      await expect(confirm).toBeDisabled();
    });
    await step("A wrong word keeps the button off", async () => {
      await dialog.getByLabel(`Type "${pat.email}" to confirm`).fill("someone else");
      await expect(confirm).toBeDisabled();
    });
    await step("Cancel keeps the user", async () => {
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      expect((await stored(pat.id)).email).toBe(pat.email);
    });
    await step("Type the email and delete", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Delete user" }).click();
      await dialog.getByLabel(`Type "${pat.email}" to confirm`).fill(pat.email);
      await expect(confirm).toBeEnabled();
      await confirm.click();
    });
    await step("The Users list opens without them", async () => {
      await expect(page).toHaveURL(/\/users$/);
      await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
      await expect(page.getByTestId("user-row").filter({ hasText: pat.email })).toHaveCount(0);
    });
    await step("The API no longer has the user", async () => {
      const gone = await app.service.get(`/admin/users/${pat.id}`, { record: false });
      expect(gone.status).toBe(404);
    });
  },
);

test(
  "the sessions list shows a user's sessions and Sign out everywhere ends them",
  {
    tag: ["@console", "@users", "@security"],
    annotation: about(
      "A user with two sessions lists both. Sign out everywhere asks first, Cancel changes nothing, and confirming ends both: the list says there are no active sessions, the button goes away and the refresh tokens stop working.",
    ),
  },
  async ({ page }) => {
    const ana = await app.user("ana");
    const second = await app.userSession(ana.email, ana.password);
    await openAs(page, await app.root(), `/users/${ana.id}`);
    const card = page.getByRole("region", { name: "Sessions" });
    await step("Two sessions are listed", async () => {
      await expect(card.getByRole("listitem")).toHaveCount(2);
      await expect(card.getByText("Password").first()).toBeVisible();
    });
    const dialog = page.getByRole("dialog", { name: "Sign out everywhere?" });
    await step("Cancel in the dialog changes nothing", async () => {
      await page.getByTestId("sign-out-everywhere").click();
      await expect(dialog).toContainText(`Ends every session ${ana.email} has.`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(card.getByRole("listitem")).toHaveCount(2);
    });
    await step("Confirm Sign out everywhere", async () => {
      await page.getByTestId("sign-out-everywhere").click();
      await dialog.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(page.getByText("Signed out everywhere.")).toBeVisible();
      await expect(card.getByText("No active sessions.")).toBeVisible();
      await expect(page.getByTestId("sign-out-everywhere")).toHaveCount(0);
    });
    await step("Both refresh tokens are dead", async () => {
      for (const tokens of [ana.tokens!, second.tokens]) {
        const refreshed = await app.api.post("/auth/refresh", { refreshToken: tokens.refreshToken }, { record: false });
        expect(refreshed.status).toBe(401);
      }
    });
  },
);

test(
  "personal tokens and agents the user owns are listed, and a token can be revoked",
  {
    tag: ["@console", "@users", "@tokens", "@agents"],
    annotation: about(
      "With personal tokens and user agents switched on, a user makes a token and an agent through the API. The page lists the token by name and last four, never the secret, and the agent by name with its status. Revoke asks first, and a revoked token stops trading for access tokens. The settings go back at the end.",
    ),
  },
  async ({ page }) => {
    const ana = await app.user("ana");
    const empty = await plainUser(app);
    await app.settings("selfService", { agents: true, personalTokens: true });
    try {
      await step("A user with none shows both empty states", async () => {
        await openAs(page, await app.root(), `/users/${empty.id}`);
        await expect(page.getByText("No personal tokens.")).toBeVisible();
        await expect(page.getByText("No agents.")).toBeVisible();
        await expect(page.getByTestId("user-tokens")).toHaveCount(0);
        await expect(page.getByTestId("user-agents")).toHaveCount(0);
      });
      const name = app.uniq("laptop");
      const made = await ana.api.must("POST", "/auth/personal-tokens", { name }, { record: false });
      const secret = app.secret(made.token as string);
      const agentName = app.uniq("helper");
      const agent = await ana.api.must(
        "POST",
        "/auth/agents",
        { name: agentName, description: "Runs jobs", capabilities: { repo: "dopgate" } },
        { record: false },
      );
      app.secret(agent.token as string);
      await step("The token shows by name and last four, without the secret", async () => {
        await page.goto(`/users/${ana.id}`);
        const tokens = page.getByTestId("user-tokens");
        await expect(tokens).toContainText(name);
        await expect(tokens).toContainText(`dgp_••••${made.personalToken.lastFour}`);
        await expect(tokens).toContainText("No expiry");
        await expect(page.locator("body")).not.toContainText(secret);
      });
      await step("The agent shows by name with its status and links to its page", async () => {
        const agents = page.getByTestId("user-agents");
        await expect(agents).toContainText(agentName);
        await expect(agents).toContainText("On");
        await agents.getByRole("link", { name: agentName }).click();
        await expect(page).toHaveURL(new RegExp(`/agents/${agent.agent.id}$`));
        await page.goBack();
      });
      await step("A turned-off agent says so", async () => {
        const off = await app.service.post(`/admin/agents/${agent.agent.id}/disable`, undefined, { record: false });
        // The console only; the service key cannot turn agents off.
        expect(off.ok).toBe(false);
        const root = await app.root();
        await root.api.must("POST", `/admin/agents/${agent.agent.id}/disable`, undefined, { record: false });
        await page.reload();
        await expect(page.getByTestId("user-agents")).toContainText("Turned off");
      });
      await step("Revoke asks first and Cancel keeps the token", async () => {
        const dialog = page.getByRole("dialog", { name: `Revoke “${name}”?` });
        await page.getByTestId("user-tokens").getByRole("button", { name: "Revoke" }).click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("user-tokens")).toContainText(name);
      });
      await step("Confirm Revoke", async () => {
        const dialog = page.getByRole("dialog", { name: `Revoke “${name}”?` });
        await page.getByTestId("user-tokens").getByRole("button", { name: "Revoke" }).click();
        await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
        await expect(page.getByText(`Revoked the personal token “${name}”.`)).toBeVisible();
        await expect(page.getByText("No personal tokens.")).toBeVisible();
      });
      await step("The token no longer signs in", async () => {
        const traded = await app.api.post("/auth/token", { token: secret }, { record: false });
        expect(traded.status).toBe(401);
        const left = await ana.api.get("/auth/personal-tokens", { record: false });
        expect(left.data.items).toHaveLength(0);
      });
    } finally {
      await app.settings("selfService", { agents: false, personalTokens: false });
    }
  },
);

test(
  "an unknown user id shows a not-found message with a way to retry",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "A link to a user that does not exist says that no user has this ID in place of the page, with Try again. The sidebar stays, and the Users link still works.",
    ),
  },
  async ({ page }) => {
    await openAs(page, await app.root(), "/users/usr_doesnotexist");
    await step("The alert and Try again show", async () => {
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByText("No user has this ID.")).toBeVisible();
      await expect(page.getByTestId("user-actions")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    });
    await step("Try again asks once more and gets the same answer", async () => {
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByText("No user has this ID.")).toBeVisible();
    });
    await step("The sidebar leads back to Users", async () => {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Users", exact: true }).click();
      await expect(page).toHaveURL(/\/users$/);
    });
  },
);

test(
  "an admin who is not root manages users the same way",
  {
    tag: ["@console", "@users", "@admins"],
    annotation: about(
      "Every admin manages every user. A plain admin sees the Actions menu with all its entries and can turn an account off.",
    ),
  },
  async ({ page }) => {
    const sam = await app.admin("sam");
    const pat = await plainUser(app);
    await openAs(page, sam, `/users/${pat.id}`);
    await step("The Actions menu has every entry", async () => {
      await page.getByTestId("user-actions").click();
      for (const item of ["Send password reset code", "Mark email verified", "Turn off account", "Delete user"]) {
        await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
      }
    });
    await step("Turning the account off works", async () => {
      await page.getByRole("menuitem", { name: "Turn off account" }).click();
      await page.getByRole("dialog", { name: "Turn off this account?" }).getByRole("button", { name: "Turn off" }).click();
      await expect(page.getByText("Account turned off. Its sessions have ended.")).toBeVisible();
      expect((await stored(pat.id)).status).toBe("disabled");
    });
  },
);
