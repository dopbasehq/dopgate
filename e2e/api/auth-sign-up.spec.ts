import {
  about,
  expect,
  LEAKED_PASSWORD,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims } from "../harness/helpers.ts";
import {
  ageCode,
  auditEvents,
  codeRows,
  signUp,
  withSettings,
  wrongCode,
} from "./auth.support.ts";

const app = useServer();

test(
  "the sign-in methods follow the settings and the branding",
  {
    tag: ["@auth", "@smoke"],
    annotation: about(
      "A sign-in screen asks which methods to offer. The answer needs no credentials and reflects whether sign-up is open, whether the email must be confirmed, and the app name and logo.",
    ),
  },
  async () => {
    await step("GET /auth/methods on a fresh instance", async () => {
      const methods = await app.api.get("/auth/methods");
      expect(methods.status).toBe(200);
      expect(methods.message).toBe("AUTH_METHODS_FETCHED");
      expect(methods.data).toEqual({
        signupEnabled: true,
        password: true,
        emailOtp: true,
        emailVerificationRequired: true,
        branding: { appName: "Dopgate", logoUrl: null },
      });
    });
    await step("Sign-up closed, no verification, new branding", async () => {
      await withSettings(
        app,
        "signup",
        { enabled: false, requireEmailVerification: false },
        async () => {
          await app.settings("branding", {
            appName: "Acme Accounts",
            logoUrl: "https://cdn.example.com/acme.png",
          });
          const methods = await app.api.get("/auth/methods");
          expect(methods.data).toEqual({
            signupEnabled: false,
            password: true,
            emailOtp: true,
            emailVerificationRequired: false,
            branding: {
              appName: "Acme Accounts",
              logoUrl: "https://cdn.example.com/acme.png",
            },
          });
        },
      );
      await app.settings("branding", { appName: "Dopgate", logoUrl: null });
    });
  },
);

test(
  "signing up emails a code and returns no tokens until the email is confirmed",
  {
    tag: ["@auth", "@smoke"],
    annotation: about(
      "With email confirmation required, sign-up creates the account and sends a 6-digit code. The answer holds no tokens, sign-in is refused, and confirming the code signs the person in and marks the email verified.",
    ),
  },
  async () => {
    const email = app.email("ana");
    const signUpResult = await step("POST /auth/signup with an email and a password", () =>
      signUp(app.api, email, { displayName: "Ana" }),
    );
    await step("It answers 201 SIGNED_UP with the user and no tokens", async () => {
      expect(signUpResult.status).toBe(201);
      expect(signUpResult.message).toBe("SIGNED_UP");
      expect(signUpResult.data).toMatchObject({
        verificationRequired: true,
        verificationSent: true,
        tokens: null,
        user: {
          email,
          emailVerified: false,
          displayName: "Ana",
          status: "active",
          hasPassword: true,
          lastSignInAt: null,
          userMetadata: {},
          publicMetadata: {},
        },
      });
      expect(signUpResult.data.user.id).toMatch(/^usr_/);
      expect(JSON.stringify(signUpResult.body)).not.toContain(PASSWORD);
    });
    await step("A verify_email message with a 6-digit code was sent", async () => {
      const mail = await app.mail.last(email);
      expect(mail.subject).toMatch(/\b\d{6}\b/);
      expect(mail.text).toContain("confirm your email address");
    });
    await step("POST /auth/login is refused with EMAIL_NOT_VERIFIED", async () => {
      const login = await app.api.post("/auth/login", { email, password: PASSWORD });
      expect(login.status).toBe(403);
      expect(login.code).toBe("EMAIL_NOT_VERIFIED");
    });
    const confirmed = await step("POST /auth/verification/confirm with the emailed code", async () =>
      app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: await app.mail.code(email),
      }),
    );
    await step("It signs the user in with a verified email", async () => {
      expect(confirmed.status).toBe(200);
      expect(confirmed.message).toBe("SIGNED_IN");
      expect(confirmed.data.user).toMatchObject({ email, emailVerified: true });
      expect(confirmed.data.refreshToken).toMatch(/^dgr_/);
      expect(claims(confirmed.data.accessToken)).toMatchObject({
        sub: signUpResult.data.user.id,
        email_verified: true,
      });
    });
    await step("The audit log has user.signed_up and user.email_verified", async () => {
      const signedUp = await auditEvents(app, "user.signed_up", email);
      expect(signedUp).toHaveLength(1);
      expect(signedUp[0]).toMatchObject({
        actorType: "user",
        resourceId: signUpResult.data.user.id,
        metadata: { method: "password" },
      });
      expect(await auditEvents(app, "user.email_verified", email)).toHaveLength(1);
    });
    await step("The same code cannot be used twice", async () => {
      const again = await app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: await app.mail.code(email),
      });
      expect(again.status).toBe(400);
      expect(again.code).toBe("CODE_INVALID");
    });
  },
);

test(
  "the email is trimmed and lowercased, and a taken or invalid email is refused",
  {
    tag: "@auth",
    annotation: about(
      "Emails are stored lowercase without surrounding spaces, so the same address in another case is the same account. Sign-up tells a new user the address is taken, and refuses text that is not an email.",
    ),
  },
  async () => {
    const email = app.email("Mixed");
    await step("POST /auth/signup with spaces and capitals", async () => {
      const result = await signUp(app.api, `  ${email.toUpperCase()} `);
      expect(result.status).toBe(201);
      expect(result.data.user.email).toBe(email.toLowerCase());
    });
    await step("The same address in lower case is EMAIL_TAKEN", async () => {
      const result = await signUp(app.api, email.toLowerCase());
      expect(result.status).toBe(409);
      expect(result.code).toBe("EMAIL_TAKEN");
    });
    await step("A user created by an admin holds the address too", async () => {
      const other = await app.user("held");
      const result = await signUp(app.api, other.email.toUpperCase());
      expect(result.status).toBe(409);
      expect(result.code).toBe("EMAIL_TAKEN");
    });
    for (const bad of ["not-an-email", "two@@dopbase.com", ""]) {
      await step(`An invalid email (${JSON.stringify(bad)}) is EMAIL_INVALID`, async () => {
        const result = await signUp(app.api, bad);
        expect(result.status).toBe(422);
        expect(result.code).toBe("EMAIL_INVALID");
      });
    }
    await step("A body without a password is REQUEST_INVALID", async () => {
      const result = await app.api.post("/auth/signup", { email: app.email() });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("REQUEST_INVALID");
    });
  },
);

test(
  "sign-up returns tokens at once when email confirmation is not required",
  {
    tag: "@auth",
    annotation: about(
      "With signup.requireEmailVerification off, the sign-up answer holds an access token and a refresh token. The account is still unverified, and confirming the code later marks it verified and starts another session.",
    ),
  },
  async () => {
    await withSettings(app, "signup", { requireEmailVerification: false }, async () => {
      const email = app.email("quick");
      const result = await step("POST /auth/signup", () => signUp(app.api, email));
      await step("The answer carries tokens for an unverified user", async () => {
        expect(result.status).toBe(201);
        expect(result.data.verificationRequired).toBe(false);
        expect(result.data.tokens.accessToken).toEqual(expect.any(String));
        expect(result.data.tokens.refreshToken).toMatch(/^dgr_/);
        expect(result.data.user.emailVerified).toBe(false);
        expect(claims(result.data.tokens.accessToken).email_verified).toBe(false);
      });
      await step("The access token works on GET /auth/me", async () => {
        const me = await app.api.get("/auth/me", {
          token: result.data.tokens.accessToken,
        });
        expect(me.status).toBe(200);
        expect(me.data).toMatchObject({ email, emailVerified: false });
      });
      await step("Password sign-in works without confirming", async () => {
        const login = await app.api.post("/auth/login", { email, password: PASSWORD });
        expect(login.status).toBe(200);
      });
      await step("Confirming the code later still verifies the email", async () => {
        const confirmed = await app.api.post("/auth/verification/confirm", {
          email,
          purpose: "email_verify",
          code: await app.mail.code(email),
        });
        expect(confirmed.status).toBe(200);
        expect(confirmed.data.user.emailVerified).toBe(true);
      });
    });
  },
);

test(
  "sign-up is refused while it is switched off",
  {
    tag: ["@auth", "@settings"],
    annotation: about(
      "When an admin turns signup.enabled off, the sign-up route answers 403 SIGNUP_DISABLED and creates nothing. Accounts an admin made still sign in.",
    ),
  },
  async () => {
    const existing = await app.user("early");
    const email = app.email("late");
    await withSettings(app, "signup", { enabled: false }, async () => {
      await step("POST /auth/signup answers 403 SIGNUP_DISABLED", async () => {
        const result = await signUp(app.api, email);
        expect(result.status).toBe(403);
        expect(result.code).toBe("SIGNUP_DISABLED");
      });
      await step("No code went out and no account exists", async () => {
        const login = await app.api.post("/auth/login", { email, password: PASSWORD });
        expect(login.code).toBe("AUTHENTICATION_INVALID");
        expect(await app.mail.count(email)).toBe(0);
      });
      await step("An existing account still signs in", async () => {
        const login = await app.api.post("/auth/login", {
          email: existing.email,
          password: PASSWORD,
        });
        expect(login.status).toBe(200);
      });
    });
    await step("With sign-up back on, the same email can sign up", async () => {
      expect((await signUp(app.api, email)).status).toBe(201);
    });
  },
);

test(
  "passwords that are too short, too long or too weak by setting are refused",
  {
    tag: ["@auth", "@settings"],
    annotation: about(
      "The default minimum is 8 characters and the maximum 1024 bytes. Raising password.minLength makes a password that passed before fail with PASSWORD_INVALID.",
    ),
  },
  async () => {
    const attempt = (password: string) =>
      app.api.post("/auth/signup", { email: app.email("pw"), password });
    await step("Seven characters is PASSWORD_INVALID", async () => {
      const result = await attempt("seven77");
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("Eight characters is accepted", async () => {
      expect((await attempt("eight888")).status).toBe(201);
    });
    await step("More than 1024 bytes is PASSWORD_INVALID", async () => {
      const result = await attempt("x".repeat(1025));
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("1024 bytes is accepted", async () => {
      expect((await attempt("y".repeat(1024))).status).toBe(201);
    });
    await withSettings(app, "password", { minLength: 12 }, async () => {
      await step("With minLength 12, eleven characters is refused", async () => {
        const result = await attempt("elevenchars");
        expect(result.status).toBe(422);
        expect(result.code).toBe("PASSWORD_INVALID");
      });
      await step("Twelve characters is accepted", async () => {
        expect((await attempt("twelve chars")).status).toBe(201);
      });
    });
  },
);

test(
  "a password from a data breach is refused unless the check is off or the list is down",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "Sign-up asks the leaked password list about the new password. A listed password answers PASSWORD_LEAKED. With password.rejectLeaked off it passes, and when the list itself answers with an error the password passes too.",
    ),
  },
  async () => {
    const attempt = (password: string) =>
      app.api.post("/auth/signup", { email: app.email("leak"), password });
    await step("A password on the list answers 422 PASSWORD_LEAKED", async () => {
      const lookups = app.breaches.lookups.length;
      const result = await attempt(LEAKED_PASSWORD);
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_LEAKED");
      expect(app.breaches.lookups.length).toBe(lookups + 1);
      expect(app.breaches.lookups.at(-1)?.padding).toBe("true");
    });
    await step("A password that is not on the list is accepted", async () => {
      expect((await attempt("an unlisted passphrase")).status).toBe(201);
    });
    await step("A password added to the list later is refused", async () => {
      const added = app.value();
      expect((await attempt(added)).status).toBe(201);
      app.breaches.add(added);
      const result = await attempt(added);
      expect(result.code).toBe("PASSWORD_LEAKED");
    });
    await withSettings(app, "password", { rejectLeaked: false }, async () => {
      await step("With rejectLeaked off the listed password is accepted", async () => {
        const lookups = app.breaches.lookups.length;
        expect((await attempt(LEAKED_PASSWORD)).status).toBe(201);
        expect(app.breaches.lookups.length).toBe(lookups);
      });
    });
    await step("When the list answers 503 the listed password is accepted", async () => {
      app.breaches.failWith(503);
      try {
        const result = await attempt(LEAKED_PASSWORD);
        expect(result.status).toBe(201);
      } finally {
        app.breaches.failWith(undefined);
      }
    });
    await step("Once the list answers again the password is refused", async () => {
      expect((await attempt(LEAKED_PASSWORD)).code).toBe("PASSWORD_LEAKED");
    });
  },
);

test(
  "a bad display name is refused with PROFILE_INVALID",
  {
    tag: "@auth",
    annotation: about(
      "The display name is optional, one line and at most 255 characters. A longer name or one with a line break answers 422 PROFILE_INVALID and creates no account.",
    ),
  },
  async () => {
    const email = app.email("name");
    await step("A 256-character name is PROFILE_INVALID", async () => {
      const result = await signUp(app.api, email, { displayName: "n".repeat(256) });
      expect(result.status).toBe(422);
      expect(result.code).toBe("PROFILE_INVALID");
    });
    await step("A name with a line break is PROFILE_INVALID", async () => {
      const result = await signUp(app.api, email, { displayName: "Ana\nSilva" });
      expect(result.status).toBe(422);
      expect(result.code).toBe("PROFILE_INVALID");
    });
    await step("A 255-character name signs up with the same email", async () => {
      const result = await signUp(app.api, email, { displayName: "n".repeat(255) });
      expect(result.status).toBe(201);
      expect(result.data.user.displayName).toBe("n".repeat(255));
    });
  },
);

test(
  "a new verification code replaces the old one",
  {
    tag: "@auth",
    annotation: about(
      "Asking for another email_verify code invalidates the first, so only the newest works. The first code now counts as a wrong try against the new one.",
    ),
  },
  async () => {
    const email = app.email("again");
    await signUp(app.api, email);
    const first = await app.mail.code(email);
    const sent = await step("POST /auth/verification/send for the same purpose", async () => {
      const before = await app.mail.count(email);
      const result = await app.api.post("/auth/verification/send", {
        email,
        purpose: "email_verify",
      });
      await app.mail.last(email, { after: before });
      return result;
    });
    const second = await app.mail.code(email);
    await step("It answers 200 CODE_SENT", async () => {
      expect(sent.status).toBe(200);
      expect(sent.message).toBe("CODE_SENT");
    });
    await step("The first code is refused when the codes differ", async () => {
      // One time in a million both codes are the same number.
      if (first === second) return;
      const old = await app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: first,
      });
      expect(old.status).toBe(400);
      expect(old.code).toBe("CODE_INVALID");
    });
    await step("The newest code signs in", async () => {
      const confirmed = await app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: second,
      });
      expect(confirmed.status).toBe(200);
    });
  },
);

test(
  "wrong codes count down and the last one burns the code",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "Each wrong guess says how many tries are left. After limits.codeMaxAttempts wrong tries the code is used up, and even the right code is refused until a new one is requested.",
    ),
  },
  async () => {
    const email = app.email("guess");
    await signUp(app.api, email);
    const code = await app.mail.code(email);
    const wrong = wrongCode(code);
    const confirm = (value: string) =>
      app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: value,
      });
    for (const left of [4, 3, 2, 1]) {
      await step(`A wrong code leaves ${left} ${left === 1 ? "try" : "tries"}`, async () => {
        const result = await confirm(wrong);
        expect(result.status).toBe(400);
        expect(result.body.error.CODE_INVALID).toBe(
          `That code is wrong. ${left} ${left === 1 ? "try" : "tries"} left.`,
        );
      });
    }
    await step("The fifth wrong code uses the code up", async () => {
      const result = await confirm(wrong);
      expect(result.status).toBe(400);
      expect(result.body.error.CODE_INVALID).toContain("used up");
    });
    await step("The right code is refused now", async () => {
      expect((await confirm(code)).code).toBe("CODE_INVALID");
    });
    await step("A new code starts the count again", async () => {
      const before = await app.mail.count(email);
      await app.api.post("/auth/verification/send", { email, purpose: "email_verify" });
      await app.mail.last(email, { after: before });
      expect((await confirm(await app.mail.code(email))).status).toBe(200);
    });
    await step("The setting changes the number of tries", async () => {
      await withSettings(app, "limits", { codeMaxAttempts: 2 }, async () => {
        const other = app.email("two");
        await signUp(app.api, other);
        const real = await app.mail.code(other);
        const guess = (value: string) =>
          app.api.post("/auth/verification/confirm", {
            email: other,
            purpose: "email_verify",
            code: value,
          });
        expect((await guess(wrongCode(real))).body.error.CODE_INVALID).toContain("1 try left");
        expect((await guess(wrongCode(real))).body.error.CODE_INVALID).toContain("used up");
        expect((await guess(real)).code).toBe("CODE_INVALID");
        const rows = await codeRows(app, other, "email_verify");
        expect(rows.at(-1)?.attempts).toBe(2);
      });
    });
  },
);

test(
  "spaces and dashes in a code are ignored, and an old code is expired",
  {
    tag: "@auth",
    annotation: about(
      "People paste codes with a space or a dash in the middle. Dopgate strips both. A code past its lifetime answers CODE_EXPIRED, which is different from a wrong code.",
    ),
  },
  async () => {
    const email = app.email("paste");
    await signUp(app.api, email);
    const code = await app.mail.code(email);
    const confirm = (value: string) =>
      app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: value,
      });
    await step("A code that is 10 minutes old is CODE_EXPIRED", async () => {
      await ageCode(app, email, "email_verify", 601);
      const result = await confirm(code);
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_EXPIRED");
    });
    await step("A fresh code with a space and a dash confirms", async () => {
      const before = await app.mail.count(email);
      await app.api.post("/auth/verification/send", { email, purpose: "email_verify" });
      await app.mail.last(email, { after: before });
      const fresh = await app.mail.code(email);
      const result = await confirm(` ${fresh.slice(0, 3)} - ${fresh.slice(3)} `);
      expect(result.status).toBe(200);
      expect(result.data.user.emailVerified).toBe(true);
    });
  },
);

test(
  "asking for a code answers the same for every email and sends mail only when it makes sense",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "The send route always answers 200 CODE_SENT. A real account that still needs to verify gets a message. An unknown email, a verified account for email_verify, and a disabled account get none, so the route cannot be used to find accounts.",
    ),
  },
  async () => {
    const unknown = app.email("ghost");
    const verified = await app.user("done");
    const disabled = await app.user("off");
    const pending = await app.user("pending", { verified: false });
    await app.service.must("POST", `/admin/users/${disabled.id}/disable`, undefined, {
      record: false,
    });
    const send = (email: string, purpose = "email_verify") =>
      app.api.post("/auth/verification/send", { email, purpose });
    await step("An unknown email answers CODE_SENT", async () => {
      const result = await send(unknown);
      expect(result.status).toBe(200);
      expect(result.message).toBe("CODE_SENT");
      expect(result.data).toBeNull();
    });
    await step("So does a verified account, a disabled one and a pending one", async () => {
      for (const email of [verified.email, disabled.email, pending.email]) {
        const result = await send(email);
        expect([result.status, result.message]).toEqual([200, "CODE_SENT"]);
      }
      expect((await send(disabled.email, "login")).message).toBe("CODE_SENT");
      expect((await send(unknown, "login")).message).toBe("CODE_SENT");
    });
    await step("Only the pending account got a message", async () => {
      await app.mail.code(pending.email);
      for (const email of [unknown, verified.email, disabled.email]) {
        expect(await app.mail.count(email)).toBe(0);
      }
    });
  },
);

test(
  "the code routes refuse purposes they do not handle",
  {
    tag: "@auth",
    annotation: about(
      "Sending takes email_verify or login. Confirming takes email_verify, login or email_change. A password_reset code has its own routes, and an unknown purpose or a malformed email is rejected.",
    ),
  },
  async () => {
    const email = app.email("purpose");
    await step("Sending a password_reset code is REQUEST_INVALID", async () => {
      const result = await app.api.post("/auth/verification/send", {
        email,
        purpose: "password_reset",
      });
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("Sending an email_change code is REQUEST_INVALID", async () => {
      const result = await app.api.post("/auth/verification/send", {
        email,
        purpose: "email_change",
      });
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("Confirming a password_reset code is REQUEST_INVALID", async () => {
      const result = await app.api.post("/auth/verification/confirm", {
        email,
        purpose: "password_reset",
        code: "123456",
      });
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("An unknown purpose is rejected", async () => {
      const result = await app.api.post("/auth/verification/send", {
        email,
        purpose: "everything",
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("A malformed email is EMAIL_INVALID", async () => {
      const result = await app.api.post("/auth/verification/send", {
        email: "nope",
        purpose: "login",
      });
      expect(result.status).toBe(422);
      expect(result.code).toBe("EMAIL_INVALID");
    });
    await step("Confirming a code nobody asked for is CODE_INVALID", async () => {
      const result = await app.api.post("/auth/verification/confirm", {
        email,
        purpose: "email_verify",
        code: "123456",
      });
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
    });
  },
);
