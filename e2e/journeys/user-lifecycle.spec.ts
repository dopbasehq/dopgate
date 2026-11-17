import {
  about,
  expect,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { openAs } from "../harness/helpers.ts";

const app = useServer();

test(
  "a user's life: sign up, forget the password, get turned off, come back, get deleted",
  {
    tag: ["@auth", "@users"],
    annotation: about(
      "One account from its first day to its last. A visitor signs up in the app and confirms their email, edits their profile, keeps the session alive with a refresh, forgets the password and resets it. An admin then turns the account off in the console, which signs the user out at once, turns it back on, and finally deletes it.",
    ),
  },
  async ({ page }) => {
    const email = app.email("lena");
    const newPassword = "a different horse 42";
    const user = await app.newApi("lena");
    let refreshToken = "";

    await step("Sign up in the app", async () => {
      const signedUp = await user.post("/auth/signup", {
        email,
        password: PASSWORD,
        displayName: "Lena",
      });
      expect(signedUp.message).toBe("SIGNED_UP");
      expect(signedUp.data.verificationRequired).toBe(true);
      expect(signedUp.data.tokens).toBeNull();
    });
    await step("Confirm the email with the code and get signed in", async () => {
      const confirmed = await user.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: await app.mail.code(email),
      });
      expect(confirmed.message).toBe("SIGNED_IN");
      expect(confirmed.data.user.emailVerified).toBe(true);
      user.token = confirmed.data.accessToken;
      refreshToken = confirmed.data.refreshToken;
    });
    await step("Fill in the profile", async () => {
      const updated = await user.patch("/auth/me", {
        displayName: "Lena Fischer",
        userMetadata: { theme: "dark" },
      });
      expect(updated.data.displayName).toBe("Lena Fischer");
      expect(updated.data.userMetadata).toEqual({ theme: "dark" });
    });
    await step("Keep the session with a refresh", async () => {
      const refreshed = await user.post(
        "/auth/refresh",
        { refreshToken },
        { token: null },
      );
      expect(refreshed.message).toBe("TOKENS_REFRESHED");
      user.token = refreshed.data.accessToken;
      refreshToken = refreshed.data.refreshToken;
      expect((await user.get("/auth/me")).data.email).toBe(email);
    });
    await step("Forget the password and reset it with the emailed code", async () => {
      const before = await app.mail.count(email);
      await app.api.post("/auth/password/forgot", { email });
      const reset = await app.api.post("/auth/password/reset", {
        email,
        code: await app.mail.code(email, { after: before }),
        newPassword,
      });
      expect(reset.message).toBe("PASSWORD_RESET");
    });
    await step("The reset ended the old session; the new password signs in", async () => {
      const stale = await user.post(
        "/auth/refresh",
        { refreshToken },
        { token: null },
      );
      expect(stale.code).toBe("TOKEN_INVALID");
      const old = await app.api.post("/auth/login", { email, password: PASSWORD });
      expect(old.code).toBe("AUTHENTICATION_INVALID");
      const signedIn = await user.signIn("/auth/login", email, newPassword);
      expect(signedIn.message).toBe("SIGNED_IN");
    });

    await step("An admin finds the user in the console", async () => {
      await openAs(page, await app.root(), "/users");
      await page.getByPlaceholder("Search by email or name").fill("Fischer");
      const row = page.getByTestId("user-row");
      await expect(row).toHaveCount(1);
      await row.getByRole("link", { name: email }).click();
      await expect(page.getByRole("heading", { name: email })).toBeVisible();
      await expect(page.getByText("Email verified")).toBeVisible();
    });
    await step("The admin turns the account off", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Turn off account" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Turn off" })
        .click();
      await expect(
        page.getByText("Account turned off. Its sessions have ended."),
      ).toBeVisible();
    });
    await step("The user is signed out and can't sign in", async () => {
      // Turning the account off ended the session, so the token is refused
      // as one without a session.
      const me = await user.get("/auth/me");
      expect(me.status).toBe(401);
      expect(me.code).toBe("TOKEN_INVALID");
      const refused = await app.api.post("/auth/login", {
        email,
        password: newPassword,
      });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("ACCOUNT_DISABLED");
    });
    await step("The admin turns it back on and the user signs in again", async () => {
      await page.getByTestId("user-actions").click();
      await page
        .getByRole("menuitem", { name: "Turn account back on" })
        .click();
      await expect(page.getByText("Account turned back on.")).toBeVisible();
      const signedIn = await user.signIn("/auth/login", email, newPassword);
      expect(signedIn.message).toBe("SIGNED_IN");
    });
    await step("The admin deletes the user", async () => {
      await page.getByTestId("user-actions").click();
      await page.getByRole("menuitem", { name: "Delete user" }).click();
      // Deleting asks for the email to be typed out first.
      const dialog = page.getByRole("dialog");
      await dialog.getByPlaceholder(email).fill(email);
      await dialog.getByRole("button", { name: "Delete user" }).click();
      await expect(page).toHaveURL(/\/users$/);
      await expect(
        page.getByTestId("user-row").filter({ hasText: email }),
      ).toHaveCount(0);
    });
    await step("The account is gone: the same email and password are unknown", async () => {
      const gone = await app.api.post("/auth/login", {
        email,
        password: newPassword,
      });
      expect(gone.code).toBe("AUTHENTICATION_INVALID");
      expect((await user.get("/auth/me")).ok).toBe(false);
    });
  },
);
