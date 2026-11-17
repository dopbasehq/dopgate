import {
  about,
  expect,
  LEAKED_PASSWORD,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import {
  ageCode,
  auditEvents,
  NEW_PASSWORD,
  withSettings,
  wrongCode,
} from "./auth.support.ts";

const app = useServer();

/** Asks for a reset code and returns it once the message arrived. */
async function resetCode(email: string): Promise<string> {
  const before = await app.mail.count(email);
  const sent = await app.api.post("/auth/password/forgot", { email }, { record: false });
  expect(sent.status).toBe(200);
  await app.mail.last(email, { after: before });
  return app.mail.code(email);
}

const reset = (email: string, code: string, newPassword = NEW_PASSWORD) =>
  app.api.post("/auth/password/reset", { email, code, newPassword });

test(
  "asking for a reset code answers the same for every email and mails only active accounts",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "POST /auth/password/forgot always answers 200 PASSWORD_RESET_SENT. An active account gets a password_reset message with a code. An unknown email and a disabled account get nothing, so the route cannot be used to find accounts.",
    ),
  },
  async () => {
    const active = await app.user("active");
    const disabled = await app.user("disabled");
    await app.service.must("POST", `/admin/users/${disabled.id}/disable`, undefined, { record: false });
    const unknown = app.email("ghost");
    const forgot = (email: string) => app.api.post("/auth/password/forgot", { email });
    const answers = await step("POST /auth/password/forgot for an active, a disabled and an unknown email", async () => [
      await forgot(active.email),
      await forgot(disabled.email),
      await forgot(unknown),
    ]);
    await step("All three answer 200 PASSWORD_RESET_SENT with the same body", async () => {
      for (const answer of answers) {
        expect(answer.status).toBe(200);
        expect(answer.message).toBe("PASSWORD_RESET_SENT");
      }
      expect(answers[1]!.body).toEqual(answers[0]!.body);
      expect(answers[2]!.body).toEqual(answers[0]!.body);
    });
    await step("The active account got a code to reset its password", async () => {
      const mail = await app.mail.last(active.email);
      expect(mail.subject).toBe("Reset your Dopgate password");
      expect(await app.mail.code(active.email)).toMatch(/^\d{6}$/);
      expect(await app.mail.count(active.email)).toBe(1);
    });
    await step("The disabled account and the unknown email got nothing", async () => {
      expect(await app.mail.count(disabled.email)).toBe(0);
      expect(await app.mail.count(unknown)).toBe(0);
    });
    await step("An email in other capitals reaches the account", async () => {
      const before = await app.mail.count(active.email);
      await forgot(active.email.toUpperCase());
      await app.mail.last(active.email, { after: before });
    });
    await step("A malformed email is 422 EMAIL_INVALID", async () => {
      const result = await forgot("nope");
      expect(result.status).toBe(422);
      expect(result.code).toBe("EMAIL_INVALID");
    });
    await step("A body without an email is REQUEST_INVALID", async () => {
      const result = await app.api.post("/auth/password/forgot", {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe("REQUEST_INVALID");
    });
  },
);

test(
  "a reset code sets a new password and ends every session",
  {
    tag: ["@auth", "@security", "@smoke"],
    annotation: about(
      "POST /auth/password/reset with the emailed code sets the new password, ends every session of the account, marks the email verified and emails a password_changed notice. It does not sign anyone in, and the code works once.",
    ),
  },
  async () => {
    const user = await app.user("forgetful", { signIn: false });
    const laptop = await app.userSession(user.email, PASSWORD, "laptop");
    const phone = await app.userSession(user.email, PASSWORD, "phone");
    const code = await step("POST /auth/password/forgot and read the code", () => resetCode(user.email));
    const before = await app.mail.count(user.email);
    const done = await step("POST /auth/password/reset with the code and a new password", () =>
      reset(user.email, code),
    );
    await step("It answers 200 PASSWORD_RESET with no tokens", async () => {
      expect(done.status).toBe(200);
      expect(done.message).toBe("PASSWORD_RESET");
      expect(done.data).toBeNull();
      expect(JSON.stringify(done.body)).not.toContain("accessToken");
    });
    await step("Every session is gone", async () => {
      for (const device of [laptop, phone]) {
        const me = await device.api.get("/auth/me");
        expect(me.status).toBe(401);
        expect(me.code).toBe("TOKEN_INVALID");
        const refresh = await device.api.post("/auth/refresh", { refreshToken: device.tokens.refreshToken });
        expect(refresh.code).toBe("TOKEN_INVALID");
      }
    });
    await step("A password_changed notice went out", async () => {
      const mail = await app.mail.last(user.email, { after: before });
      expect(mail.subject).toBe("Your Dopgate password was changed");
      expect(mail.text).not.toContain(NEW_PASSWORD);
    });
    await step("The new password signs in and the old one does not", async () => {
      expect((await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD })).status).toBe(200);
      const old = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
      expect(old.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("The audit log has user.password_reset with the sessions it ended", async () => {
      const events = await auditEvents(app, "user.password_reset", user.email);
      expect(events).toHaveLength(1);
      expect(events[0]!.metadata).toMatchObject({ sessionsEnded: 2 });
    });
    await step("The code cannot be used a second time", async () => {
      const again = await reset(user.email, code, "a third long passphrase");
      expect(again.status).toBe(400);
      expect(again.code).toBe("CODE_INVALID");
    });
  },
);

test(
  "a reset proves the inbox, so it verifies the email and clears a lockout",
  {
    tag: ["@auth", "@security", "@limits"],
    annotation: about(
      "An account whose email was never confirmed becomes verified by a password reset, because the user read the mail. A locked account is unlocked, and the wrong-password count starts again.",
    ),
  },
  async () => {
    const pending = await app.user("pending", { verified: false });
    await step("Before the reset the unverified account cannot sign in", async () => {
      const result = await app.api.post("/auth/login", { email: pending.email, password: PASSWORD });
      expect(result.code).toBe("EMAIL_NOT_VERIFIED");
    });
    await step("A reset with the emailed code succeeds", async () => {
      expect((await reset(pending.email, await resetCode(pending.email))).status).toBe(200);
    });
    await step("The email is verified and the new password signs in", async () => {
      const login = await app.api.post("/auth/login", { email: pending.email, password: NEW_PASSWORD });
      expect(login.status).toBe(200);
      expect(login.data.user.emailVerified).toBe(true);
    });
    const locked = await app.user("locked", { signIn: false });
    await withSettings(app, "limits", { lockoutAttempts: 2 }, async () => {
      await step("Two wrong passwords lock the other account", async () => {
        for (let i = 0; i < 2; i++) {
          await app.api.post("/auth/login", { email: locked.email, password: "wrong again" });
        }
        const stored = await app.service.get(`/admin/users/${locked.id}`, { record: false });
        expect(stored.data.lockedUntil).toEqual(expect.any(String));
        const right = await app.api.post("/auth/login", { email: locked.email, password: PASSWORD });
        expect(right.code).toBe("AUTHENTICATION_INVALID");
      });
      await step("A reset clears the lock and the count", async () => {
        expect((await reset(locked.email, await resetCode(locked.email))).status).toBe(200);
        const stored = await app.service.get(`/admin/users/${locked.id}`, { record: false });
        expect(stored.data.lockedUntil).toBeNull();
        // One wrong password after the reset is a plain miss, not a second lock.
        await app.api.post("/auth/login", { email: locked.email, password: "wrong again" });
        const login = await app.api.post("/auth/login", { email: locked.email, password: NEW_PASSWORD });
        expect(login.status).toBe(200);
      });
    });
  },
);

test(
  "a reset code gives wrong, expired and replaced codes their own answers",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A wrong code counts down tries and is burned after the limit. An expired code is CODE_EXPIRED. Asking again replaces the code, and a code for another email or another purpose does not work. Spaces and dashes in the code are ignored.",
    ),
  },
  async () => {
    const user = await app.user("codes", { signIn: false });
    const other = await app.user("other", { signIn: false });
    await step("A wrong code says how many tries are left", async () => {
      const code = await resetCode(user.email);
      const wrong = await reset(user.email, wrongCode(code));
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.CODE_INVALID).toBe("That code is wrong. 4 tries left.");
    });
    await step("After five wrong tries even the right code is refused", async () => {
      const code = await resetCode(user.email);
      for (let i = 0; i < 4; i++) await reset(user.email, wrongCode(code));
      const last = await reset(user.email, wrongCode(code));
      expect(last.body.error.CODE_INVALID).toContain("used up");
      expect((await reset(user.email, code)).code).toBe("CODE_INVALID");
    });
    await step("A new code replaces the old one", async () => {
      const first = await resetCode(user.email);
      const second = await resetCode(user.email);
      if (first !== second) {
        expect((await reset(user.email, first)).code).toBe("CODE_INVALID");
      }
    });
    await step("The code does not work for another email", async () => {
      const code = await resetCode(user.email);
      const result = await reset(other.email, code);
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
      expect((await app.api.post("/auth/login", { email: other.email, password: PASSWORD })).status).toBe(200);
    });
    await step("A login code does not reset a password", async () => {
      const before = await app.mail.count(user.email);
      await app.api.post("/auth/verification/send", { email: user.email, purpose: "login" }, { record: false });
      await app.mail.last(user.email, { after: before });
      const result = await reset(user.email, await app.mail.code(user.email));
      expect(result.code).toBe("CODE_INVALID");
    });
    await step("An email nobody has answers CODE_INVALID", async () => {
      const result = await reset(app.email("ghost"), "123456");
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
    });
    await step("An expired code answers 400 CODE_EXPIRED", async () => {
      const code = await resetCode(user.email);
      await ageCode(app, user.email, "password_reset", 601);
      const result = await reset(user.email, code);
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_EXPIRED");
    });
    await step("A code with a space and a dash still works", async () => {
      const code = await resetCode(user.email);
      const result = await reset(user.email.toUpperCase(), `${code.slice(0, 3)} - ${code.slice(3)}`);
      expect(result.status).toBe(200);
    });
  },
);

test(
  "a bad new password is refused and the code stays usable",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A new password that is too short, too long or on the leaked list is refused with 422 and the password stays as it was. The code is not used up, so the person can try again with a better password.",
    ),
  },
  async () => {
    const user = await app.user("weak", { signIn: false });
    const code = await resetCode(user.email);
    await step("Seven characters is 422 PASSWORD_INVALID", async () => {
      const result = await reset(user.email, code, "seven77");
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("More than 1024 bytes is 422 PASSWORD_INVALID", async () => {
      const result = await reset(user.email, code, "x".repeat(1025));
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("A leaked password is 422 PASSWORD_LEAKED", async () => {
      const result = await reset(user.email, code, LEAKED_PASSWORD);
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_LEAKED");
    });
    await step("The old password still works", async () => {
      expect((await app.api.post("/auth/login", { email: user.email, password: PASSWORD })).status).toBe(200);
    });
    await withSettings(app, "password", { minLength: 14 }, async () => {
      await step("With minLength 14 a 12-character password is refused", async () => {
        const result = await reset(user.email, code, "twelve chars");
        expect(result.code).toBe("PASSWORD_INVALID");
      });
    });
    await step("The same code then sets a good password", async () => {
      const result = await reset(user.email, code, NEW_PASSWORD);
      expect(result.status).toBe(200);
    });
    await step("A malformed email is 422 EMAIL_INVALID", async () => {
      const result = await reset("nope", "123456");
      expect(result.status).toBe(422);
      expect(result.code).toBe("EMAIL_INVALID");
    });
    await step("A missing new password is REQUEST_INVALID", async () => {
      const result = await app.api.post("/auth/password/reset", { email: user.email, code: "123456" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("REQUEST_INVALID");
    });
  },
);

test(
  "a code for an account that was disabled afterwards is refused",
  {
    tag: ["@auth", "@users"],
    annotation: about(
      "The code went out while the account was active. If an admin disables it before the code is used, the reset answers 403 ACCOUNT_DISABLED and the password does not change.",
    ),
  },
  async () => {
    const user = await app.user("benched", { signIn: false });
    const code = await resetCode(user.email);
    await step("An admin disables the account", async () => {
      await app.service.must("POST", `/admin/users/${user.id}/disable`, undefined, { record: false });
    });
    await step("POST /auth/password/reset answers 403 ACCOUNT_DISABLED", async () => {
      const result = await reset(user.email, code);
      expect(result.status).toBe(403);
      expect(result.code).toBe("ACCOUNT_DISABLED");
    });
    await step("Enabling it brings back the old password only", async () => {
      await app.service.must("POST", `/admin/users/${user.id}/enable`, undefined, { record: false });
      expect((await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD })).status).toBe(401);
      expect((await app.api.post("/auth/login", { email: user.email, password: PASSWORD })).status).toBe(200);
    });
  },
);

test(
  "an account that has no password gets its first one from a reset",
  {
    tag: ["@auth"],
    annotation: about(
      "A user created without a password can still use the reset flow. After it, hasPassword is true and the password signs in.",
    ),
  },
  async () => {
    const user = await app.user("codeonly", { password: false });
    await step("A password sign-in fails before the reset", async () => {
      const result = await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD });
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("POST /auth/password/reset with the emailed code", async () => {
      const result = await reset(user.email, await resetCode(user.email));
      expect(result.status).toBe(200);
    });
    await step("The new password signs in and hasPassword is true", async () => {
      const login = await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD });
      expect(login.status).toBe(200);
      expect(login.data.user.hasPassword).toBe(true);
    });
  },
);
