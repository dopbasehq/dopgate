import type { Page } from "@playwright/test";
import {
  about,
  expect,
  LEAKED_PASSWORD,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";
import { seeHeading } from "./instance.support.ts";

const app = useServer();

const SECTIONS = ["signup", "password", "limits", "tokens", "selfService", "branding"];
let baseline: Record<string, any> = {};

// The harness raises three limits at boot. Every test starts from the
// settings the server booted with, whatever the test before it did.
test.beforeAll(async () => {
  const root = await app.root();
  baseline = (await root.api.get("/admin/settings", { record: false })).data;
});

test.afterEach(async () => {
  const root = await app.root();
  const restore = Object.fromEntries(SECTIONS.map((name) => [name, baseline[name]]));
  await root.api.patch("/admin/settings", restore, { record: false });
});

const section = (page: Page, name: string) => page.getByTestId(`settings-${name}`);
const saveButton = (page: Page, name: string) =>
  section(page, name).getByRole("button", { name: "Save", exact: true });
const toggle = (page: Page, name: string, label: string) =>
  section(page, name).getByRole("switch", { name: label, exact: true });
/** The switch's input is visually hidden, so a click goes to the label around it. */
const flip = (page: Page, name: string, label: string) =>
  toggle(page, name, label).locator("xpath=..").click();

async function readSettings() {
  return (await (await app.root()).api.get("/admin/settings", { record: false })).data;
}

test(
  "every section shows the values the server holds",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "The Settings page has a card for sign-up, passwords, codes and lockout, sessions, personal tokens and agents, branding and email delivery. Each shows what the server holds, and every Save button is off until something changes.",
    ),
  },
  async ({ page }) => {
    await step("Open the Settings page", async () => {
      await openAs(page, await app.root(), "/settings");
      await seeHeading(page, "Settings");
      for (const name of [...SECTIONS, "smtp"]) {
        await expect(section(page, name)).toBeVisible();
      }
    });
    await step("Signup shows its three switches", async () => {
      await expect(toggle(page, "signup", "Open sign-up")).toBeChecked();
      await expect(
        toggle(page, "signup", "Verified email"),
      ).toBeChecked();
      await expect(
        toggle(page, "signup", "Email code sign-up"),
      ).not.toBeChecked();
    });
    await step("Password shows the minimum length and the leaked password switch", async () => {
      await expect(section(page, "password").getByLabel("Minimum length")).toHaveValue("8");
      await expect(
        toggle(page, "password", "Refuse leaked passwords"),
      ).toBeChecked();
    });
    await step("Codes and lockout show the limits the server runs with", async () => {
      const limits = section(page, "limits");
      await expect(limits.getByLabel("Code lifetime (minutes)")).toHaveValue("10");
      await expect(limits.getByLabel("Tries per code")).toHaveValue("5");
      await expect(limits.getByLabel("Resend wait (seconds)")).toHaveValue(
        String(baseline.limits.codeResendSeconds),
      );
      await expect(limits.getByLabel("Codes per hour")).toHaveValue(
        String(baseline.limits.codesPerHour),
      );
      await expect(limits.getByLabel("Failed sign-ins before lockout")).toHaveValue("5");
      await expect(limits.getByLabel("Lockout length (minutes)")).toHaveValue("15");
      await expect(limits.getByLabel("Requests per minute per IP")).toHaveValue(
        String(baseline.limits.ipRequestsPerMinute),
      );
    });
    await step("Tokens show their lifetimes", async () => {
      const tokens = section(page, "tokens");
      await expect(tokens.getByLabel("Access token lifetime (minutes)")).toHaveValue("15");
      await expect(tokens.getByLabel("Idle sign-out (days)")).toHaveValue("30");
      await expect(tokens.getByLabel("Session length (days)")).toHaveValue("90");
      await expect(tokens.getByLabel("Repeat refresh window (seconds)")).toHaveValue("10");
    });
    await step("Tokens and agents show switches off and the caps", async () => {
      const rules = section(page, "selfService");
      await expect(
        toggle(page, "selfService", "Users can create personal tokens"),
      ).not.toBeChecked();
      await expect(
        toggle(page, "selfService", "Users can create agents of their own"),
      ).not.toBeChecked();
      await expect(rules.getByLabel("Personal tokens per user")).toHaveValue("10");
      await expect(rules.getByLabel("Agents per user")).toHaveValue("10");
    });
    await step("Branding shows the app name and an empty logo", async () => {
      await expect(section(page, "branding").getByLabel("App name")).toHaveValue("Dopgate");
      await expect(section(page, "branding").getByLabel("Logo URL")).toHaveValue("");
    });
    await step("No Save button is on and nothing says Saved", async () => {
      for (const name of SECTIONS) {
        await expect(saveButton(page, name)).toBeDisabled();
      }
      await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
    });
  },
);

test(
  "turning sign-up off saves, survives a reload and refuses new sign-ups",
  {
    tag: ["@settings", "@console", "@auth"],
    annotation: about(
      "The sign-up switch is saved on its own. After a reload it is still off, and POST /auth/signup answers SIGNUP_DISABLED. Turning it back on lets a sign-up through.",
    ),
  },
  async ({ page }) => {
    await step("Open Settings and switch sign-up off", async () => {
      await openAs(page, await app.root(), "/settings");
      await expect(section(page, "signup")).toBeVisible();
      await flip(page, "signup", "Open sign-up");
      await expect(saveButton(page, "signup")).toBeEnabled();
      await expect(section(page, "signup").getByRole("button", { name: "Discard" })).toBeVisible();
    });
    await step("Save", async () => {
      await saveButton(page, "signup").click();
      await expect(section(page, "signup").getByText("Saved", { exact: true })).toBeVisible();
      await expect(saveButton(page, "signup")).toBeDisabled();
    });
    await step("A reload keeps it off", async () => {
      await page.reload();
      await expect(toggle(page, "signup", "Open sign-up")).not.toBeChecked();
      expect((await readSettings()).signup.enabled).toBe(false);
    });
    await step("POST /auth/signup answers SIGNUP_DISABLED", async () => {
      const refused = await app.api.post(
        "/auth/signup",
        { email: app.email("closed"), password: PASSWORD },
        { record: false },
      );
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("SIGNUP_DISABLED");
    });
    await step("Switch it back on and a sign-up works", async () => {
      await flip(page, "signup", "Open sign-up");
      await saveButton(page, "signup").click();
      await expect(section(page, "signup").getByText("Saved", { exact: true })).toBeVisible();
      const created = await app.api.post(
        "/auth/signup",
        { email: app.email("open"), password: PASSWORD },
        { record: false },
      );
      expect(created.status).toBe(201);
    });
  },
);

test(
  "the email verification and passwordless switches change how sign-up works",
  {
    tag: ["@settings", "@console", "@auth"],
    annotation: about(
      "With email verification off, a new user signs in right after signing up. With passwordless sign-up on, an email with no account can ask for a sign-in code.",
    ),
  },
  async ({ page }) => {
    await step("Switch both and save", async () => {
      await openAs(page, await app.root(), "/settings");
      await flip(page, "signup", "Verified email");
      await flip(page, "signup", "Email code sign-up");
      await saveButton(page, "signup").click();
      await expect(section(page, "signup").getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("The server holds both changes and keeps sign-up on", async () => {
      const signup = (await readSettings()).signup;
      expect(signup).toEqual({
        enabled: true,
        requireEmailVerification: false,
        passwordlessSignup: true,
      });
    });
    const email = app.email("noverify");
    await step("A new user signs in without confirming their email", async () => {
      const created = await app.api.post("/auth/signup", { email, password: PASSWORD }, { record: false });
      expect(created.status).toBe(201);
      const login = await app.api.post("/auth/login", { email, password: PASSWORD }, { record: false });
      expect(login.status).toBe(200);
    });
    await step("An unknown email can get a sign-in code", async () => {
      const lonely = app.email("codeonly");
      const sent = await app.api.post(
        "/auth/verification/send",
        { email: lonely, purpose: "login" },
        { record: false },
      );
      expect(sent.status).toBe(200);
      expect(await app.mail.code(lonely)).toMatch(/^\d{6}$/);
    });
  },
);

test(
  "the password minimum length and the leaked password switch take effect",
  {
    tag: ["@settings", "@console", "@security"],
    annotation: about(
      "Raising the minimum length makes a shorter password fail at sign-up. Switching off the breach check lets a leaked password through, and switching it on again refuses it.",
    ),
  },
  async ({ page }) => {
    await step("Open Settings and require 30 characters", async () => {
      await openAs(page, await app.root(), "/settings");
      await section(page, "password").getByLabel("Minimum length").fill("30");
      await saveButton(page, "password").click();
      await expect(section(page, "password").getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("A 21 character password is now refused at sign-up", async () => {
      const refused = await app.api.post(
        "/auth/signup",
        { email: app.email("short"), password: PASSWORD },
        { record: false },
      );
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("PASSWORD_INVALID");
      expect(refused.body.error.PASSWORD_INVALID).toContain("30");
    });
    await step("Back to 8 and a leaked password is refused while the switch is on", async () => {
      await section(page, "password").getByLabel("Minimum length").fill("8");
      await saveButton(page, "password").click();
      await expect(section(page, "password").getByText("Saved", { exact: true })).toBeVisible();
      const leaked = await app.api.post(
        "/auth/signup",
        { email: app.email("leaky"), password: LEAKED_PASSWORD },
        { record: false },
      );
      expect(leaked.status).toBe(422);
      expect(leaked.code).toBe("PASSWORD_LEAKED");
    });
    await step("With the switch off the same password is accepted", async () => {
      await flip(page, "password", "Refuse leaked passwords");
      await saveButton(page, "password").click();
      await expect(section(page, "password").getByText("Saved", { exact: true })).toBeVisible();
      const created = await app.api.post(
        "/auth/signup",
        { email: app.email("leaky2"), password: LEAKED_PASSWORD },
        { record: false },
      );
      expect(created.status).toBe(201);
    });
    await step("The page explains what the check sends", async () => {
      await expect(
        section(page, "password").getByText("The password never leaves this server.", {
          exact: false,
        }),
      ).toBeVisible();
    });
  },
);

test(
  "out of range password and token values are caught",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "A blank or zero value is caught by the form. A number the form allows but the server refuses, such as a 4 character minimum, shows SETTINGS_INVALID's message in that section. Nothing is saved.",
    ),
  },
  async ({ page }) => {
    await step("Open Settings", async () => {
      await openAs(page, await app.root(), "/settings");
      await expect(section(page, "password")).toBeVisible();
    });
    await step("A minimum length of 0 is caught by the form", async () => {
      await section(page, "password").getByLabel("Minimum length").fill("0");
      await saveButton(page, "password").click();
      await expect(
        section(page, "password").getByText("Enter a whole number of at least 1."),
      ).toBeVisible();
    });
    await step("A decimal is caught too", async () => {
      await section(page, "password").getByLabel("Minimum length").fill("8.5");
      await saveButton(page, "password").click();
      await expect(
        section(page, "password").getByText("Enter a whole number of at least 1."),
      ).toBeVisible();
    });
    await step("A minimum of 4 reaches the server, which refuses it", async () => {
      await section(page, "password").getByLabel("Minimum length").fill("4");
      await saveButton(page, "password").click();
      await expect(section(page, "password").getByRole("alert")).toBeVisible();
      expect((await readSettings()).password.minLength).toBe(8);
    });
    await step("A session shorter than the idle limit is refused by the server", async () => {
      const tokens = section(page, "tokens");
      await tokens.getByLabel("Idle sign-out (days)").fill("30");
      await tokens.getByLabel("Session length (days)").fill("10");
      await saveButton(page, "tokens").click();
      await expect(tokens.getByRole("alert")).toBeVisible();
      expect((await readSettings()).tokens.sessionAbsoluteDays).toBe(90);
    });
    await step("A refresh window of 61 seconds is refused by the server", async () => {
      const tokens = section(page, "tokens");
      await tokens.getByLabel("Session length (days)").fill("90");
      await tokens.getByLabel("Repeat refresh window (seconds)").fill("61");
      await saveButton(page, "tokens").click();
      await expect(tokens.getByRole("alert")).toBeVisible();
      expect((await readSettings()).tokens.refreshReuseSeconds).toBe(10);
    });
    await step("The raw API gives SETTINGS_INVALID for the same value", async () => {
      const root = await app.root();
      const refused = await root.api.patch(
        "/admin/settings",
        { password: { minLength: 4, rejectLeaked: true } },
        { record: false },
      );
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("SETTINGS_INVALID");
    });
  },
);

test(
  "token lifetimes save and show in the next access token",
  {
    tag: ["@settings", "@console", "@tokens"],
    annotation: about(
      "Changing the access token lifetime to 5 minutes makes the next sign-in answer expiresIn 300. A refresh window of 0 is allowed and turns repeat refreshes off.",
    ),
  },
  async ({ page }) => {
    await step("Set the access token lifetime to 5 minutes and the refresh window to 0", async () => {
      await openAs(page, await app.root(), "/settings");
      const tokens = section(page, "tokens");
      await tokens.getByLabel("Access token lifetime (minutes)").fill("5");
      await tokens.getByLabel("Repeat refresh window (seconds)").fill("0");
      await saveButton(page, "tokens").click();
      await expect(tokens.getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("A reload shows the saved numbers", async () => {
      await page.reload();
      const tokens = section(page, "tokens");
      await expect(tokens.getByLabel("Access token lifetime (minutes)")).toHaveValue("5");
      await expect(tokens.getByLabel("Repeat refresh window (seconds)")).toHaveValue("0");
    });
    await step("The next sign-in gets a 300 second access token", async () => {
      const user = await app.user("lifetime", { signIn: false });
      const login = await app.api.post(
        "/auth/login",
        { email: user.email, password: PASSWORD },
        { record: false },
      );
      expect(login.status).toBe(200);
      expect(login.data.expiresIn).toBe(300);
    });
  },
);

test(
  "codes and lockout settings save, and values outside the range are refused",
  {
    tag: ["@settings", "@console", "@limits"],
    annotation: about(
      "The code lifetime and the resend wait are changed and saved while the other limits stay as they were. A resend wait of 0 is allowed, since it turns the wait off. A codes-per-hour value above 100 is refused by the server and nothing is stored.",
    ),
  },
  async ({ page }) => {
    const limits = () => section(page, "limits");
    await step("Change the code lifetime to 7 minutes and the resend wait to 30 seconds", async () => {
      await openAs(page, await app.root(), "/settings");
      await limits().getByLabel("Code lifetime (minutes)").fill("7");
      await limits().getByLabel("Resend wait (seconds)").fill("30");
      await saveButton(page, "limits").click();
      await expect(limits().getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("The server holds it and the other limits are untouched", async () => {
      const saved = (await readSettings()).limits;
      expect(saved).toEqual({ ...baseline.limits, codeMinutes: 7, codeResendSeconds: 30 });
    });
    await step("A resend wait of 0 saves: it turns the wait off", async () => {
      await limits().getByLabel("Resend wait (seconds)").fill("0");
      await saveButton(page, "limits").click();
      await expect(limits().getByText("Saved", { exact: true })).toBeVisible();
      expect((await readSettings()).limits.codeResendSeconds).toBe(0);
    });
    await step("A blank field is caught by the form", async () => {
      await limits().getByLabel("Tries per code").fill("");
      await saveButton(page, "limits").click();
      await expect(
        limits().getByText("Enter a whole number of at least 1."),
      ).toBeVisible();
    });
    await step("101 codes per hour reaches the server and is refused", async () => {
      await limits().getByLabel("Tries per code").fill("5");
      await limits().getByLabel("Codes per hour").fill("101");
      await saveButton(page, "limits").click();
      await expect(limits().getByRole("alert")).toBeVisible();
      expect((await readSettings()).limits.codesPerHour).toBe(baseline.limits.codesPerHour);
    });
    await step("Discard puts the saved values back", async () => {
      await limits().getByRole("button", { name: "Discard" }).click();
      await expect(limits().getByLabel("Codes per hour")).toHaveValue(
        String(baseline.limits.codesPerHour),
      );
      await expect(limits().getByLabel("Resend wait (seconds)")).toHaveValue("0");
      await expect(limits().getByLabel("Code lifetime (minutes)")).toHaveValue("7");
      await expect(saveButton(page, "limits")).toBeDisabled();
    });
  },
);

test(
  "the self-service switches decide whether users can make agents",
  {
    tag: ["@settings", "@console", "@agents"],
    annotation: about(
      "Turning on agents for users lets a user make one at POST /auth/agents. Turning it off answers FEATURE_DISABLED. The per-user caps accept 1 to 1000.",
    ),
  },
  async ({ page }) => {
    const user = await app.user("maker");
    await step("Without the switch a user can't make an agent", async () => {
      const refused = await user.api.post(
        "/auth/agents",
        { name: app.uniq("bot"), capabilities: {} },
        { record: false },
      );
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("FEATURE_DISABLED");
    });
    await step("Turn on agents and set the cap to 1", async () => {
      await openAs(page, await app.root(), "/settings");
      await flip(page, "selfService", "Users can create agents of their own");
      await section(page, "selfService").getByLabel("Agents per user").fill("1");
      await saveButton(page, "selfService").click();
      await expect(section(page, "selfService").getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("A user can make one agent and the second hits the cap", async () => {
      const first = await user.api.post(
        "/auth/agents",
        { name: app.uniq("bot"), capabilities: {} },
        { record: false },
      );
      expect(first.status).toBe(201);
      const second = await user.api.post(
        "/auth/agents",
        { name: app.uniq("bot"), capabilities: {} },
        { record: false },
      );
      expect(second.status).toBe(409);
      expect(second.code).toBe("LIMIT_REACHED");
    });
    await step("A cap of 1001 is caught by the form", async () => {
      await section(page, "selfService").getByLabel("Personal tokens per user").fill("1001");
      await saveButton(page, "selfService").click();
      await expect(section(page, "selfService").getByText("Use 1000 or less.")).toBeVisible();
    });
    await step("Personal tokens stay off, so a user can't make one", async () => {
      await section(page, "selfService").getByLabel("Personal tokens per user").fill("10");
      const refused = await user.api.post(
        "/auth/personal-tokens",
        { name: "laptop" },
        { record: false },
      );
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("FEATURE_DISABLED");
    });
  },
);

test(
  "the app name shows in the next email and bad branding is refused",
  {
    tag: ["@settings", "@console", "@templates"],
    annotation: about(
      "A new app name is saved and the next verification email carries it. An empty name and a logo address that isn't http or https are caught by the form.",
    ),
  },
  async ({ page }) => {
    const branding = () => section(page, "branding");
    const appName = app.uniq("Acme");
    await step("An empty name and a bad logo address are caught", async () => {
      await openAs(page, await app.root(), "/settings");
      await branding().getByLabel("App name").fill("   ");
      await branding().getByLabel("Logo URL").fill("ftp://example.com/logo.png");
      await saveButton(page, "branding").click();
      await expect(branding().getByText("Enter a name.")).toBeVisible();
      await expect(
        branding().getByText("Use a full http:// or https:// address."),
      ).toBeVisible();
    });
    await step("A real name and logo save", async () => {
      await branding().getByLabel("App name").fill(appName);
      await branding().getByLabel("Logo URL").fill("https://example.com/logo.png");
      await saveButton(page, "branding").click();
      await expect(branding().getByText("Saved", { exact: true })).toBeVisible();
      const saved = (await readSettings()).branding;
      expect(saved).toEqual({ appName, logoUrl: "https://example.com/logo.png" });
    });
    await step("The next verification email uses the app name", async () => {
      const email = app.email("branded");
      const created = await app.api.post("/auth/signup", { email, password: PASSWORD }, { record: false });
      expect(created.status).toBe(201);
      const mail = await app.mail.last(email);
      expect(`${mail.subject}\n${mail.text}`).toContain(appName);
    });
    await step("Clearing the logo address saves a null logo", async () => {
      await branding().getByLabel("Logo URL").fill("");
      await saveButton(page, "branding").click();
      await expect(branding().getByText("Saved", { exact: true })).toBeVisible();
      expect((await readSettings()).branding.logoUrl).toBeNull();
    });
  },
);

test(
  "saving one section leaves the other sections and their unsaved edits alone",
  {
    tag: ["@settings", "@console"],
    annotation: about(
      "Each card saves by itself. Saving branding doesn't change tokens that were set elsewhere, and a half-edited password card keeps its edit and its Save button.",
    ),
  },
  async ({ page }) => {
    const root = await app.root();
    await step("Set the token lifetime through the API before opening the page", async () => {
      await app.settings("tokens", { accessTokenMinutes: 20 });
      await openAs(page, root, "/settings");
      await expect(
        section(page, "tokens").getByLabel("Access token lifetime (minutes)"),
      ).toHaveValue("20");
    });
    await step("Start editing the password card without saving", async () => {
      await section(page, "password").getByLabel("Minimum length").fill("12");
      await expect(saveButton(page, "password")).toBeEnabled();
    });
    await step("Save the branding card", async () => {
      await section(page, "branding").getByLabel("App name").fill("Elsewhere");
      await saveButton(page, "branding").click();
      await expect(section(page, "branding").getByText("Saved", { exact: true })).toBeVisible();
    });
    await step("The password card still holds its edit and its Save button", async () => {
      await expect(section(page, "password").getByLabel("Minimum length")).toHaveValue("12");
      await expect(saveButton(page, "password")).toBeEnabled();
      await expect(section(page, "password").getByText("Saved", { exact: true })).toHaveCount(0);
    });
    await step("The server's other sections are as they were", async () => {
      const now = await readSettings();
      expect(now.tokens.accessTokenMinutes).toBe(20);
      expect(now.password.minLength).toBe(8);
      expect(now.branding.appName).toBe("Elsewhere");
      expect(now.limits).toEqual(baseline.limits);
    });
  },
);
