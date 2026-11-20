import {
  about,
  expect,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { nav, openAs } from "../harness/helpers.ts";

const app = useServer();

test(
  "a locked-out user writes to support and an admin gets them back in",
  {
    tag: ["@users", "@limits", "@audit"],
    annotation: about(
      "Someone tries wrong passwords until their account locks. The right password no longer works either. A support admin looks the user up in the console, sees the lock, sends a password reset code and signs the user out everywhere. The user sets a new password with the code and signs in. The audit log shows the whole story and its chain still verifies.",
    ),
  },
  async ({ page }) => {
    const user = await app.user("tariq", { displayName: "Tariq Aziz" });
    const support = await app.admin("support");
    const newPassword = "a calmer horse 77";

    await step("Five wrong passwords in a row", async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const wrong = await app.api.post("/auth/login", {
          email: user.email,
          password: "not the password",
        });
        expect(wrong.code).toBe("AUTHENTICATION_INVALID");
      }
    });
    await step("Now the right password is refused too", async () => {
      const locked = await app.api.post("/auth/login", {
        email: user.email,
        password: PASSWORD,
      });
      expect(locked.status).toBe(401);
      expect(locked.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("Support opens the user in the console and sees the lock", async () => {
      await openAs(page, support, "/users");
      await page.getByPlaceholder("Search by email or name").fill(user.email);
      await page
        .getByTestId("user-row")
        .getByRole("link", { name: user.email })
        .click();
      await expect(page.getByText(/Locked until/)).toBeVisible();
    });
    await step("Support signs the user out everywhere", async () => {
      await page.getByTestId("sign-out-everywhere").click();
      await page
        .getByRole("dialog", { name: "Sign out everywhere?" })
        .getByRole("button", { name: "Sign out everywhere" })
        .click();
      await expect(page.getByText("Signed out everywhere.")).toBeVisible();
      await expect(page.getByText("No active sessions.")).toBeVisible();
      expect((await user.api.get("/auth/me")).status).toBe(401);
    });
    const mailsBefore = await app.mail.count(user.email);
    await step("Support sends a password reset code", async () => {
      await page.getByTestId("user-actions").click();
      await page
        .getByRole("menuitem", { name: "Send password reset code" })
        .click();
      await expect(
        page.getByText(`Sent a password reset code to ${user.email}.`),
      ).toBeVisible();
    });
    await step("The user sets a new password with the code", async () => {
      const reset = await app.api.post("/auth/password/reset", {
        email: user.email,
        code: await app.mail.code(user.email, { after: mailsBefore }),
        newPassword,
      });
      expect(reset.message).toBe("PASSWORD_RESET");
    });
    await step("The lock is gone and the new password signs in", async () => {
      const signedIn = await app.api.post("/auth/login", {
        email: user.email,
        password: newPassword,
      });
      expect(signedIn.message).toBe("SIGNED_IN");
      await page.reload();
      await expect(page.getByText(/Locked until/)).toHaveCount(0);
    });
    await step("The audit log tells the story, newest first", async () => {
      await nav(page, "Audit log").click();
      await page.getByLabel("Filter by actor").fill(user.id);
      const list = page.getByTestId("audit-table");
      await expect(list.getByText("user.sign_in_failed").first()).toBeVisible();
      await expect(list.getByText("user.password_reset", { exact: true })).toBeVisible();
      await expect(list.getByTestId("audit-row").first()).toContainText("user.signed_in");
    });
    await step("What support did is recorded under their name", async () => {
      await page.getByLabel("Filter by actor").fill(support.email);
      const list = page.getByTestId("audit-table");
      await expect(list.getByText("user.password_reset_sent")).toBeVisible();
      await expect(list.getByText("user.sessions_revoked")).toBeVisible();
    });
    await step("The chain verifies", async () => {
      await page.getByTestId("verify-chain").click();
      await expect(page.getByTestId("verification")).toContainText(
        "Chain intact",
      );
    });
  },
);
