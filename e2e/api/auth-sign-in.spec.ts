import {
  about,
  COOKIE_MODE,
  expect,
  PASSWORD,
  ROOT_EMAIL,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims, jwtHeader, verifiedByJwks } from "../harness/helpers.ts";
import {
  auditEvents,
  NEW_PASSWORD,
  sessionOf,
  withSettings,
  wrongCode,
} from "./auth.support.ts";

const app = useServer();

test(
  "password sign-in returns an ES256 token that the key set verifies",
  {
    tag: ["@auth", "@tokens", "@smoke"],
    annotation: about(
      "A user signs in with email and password and gets an access token and a refresh token. A backend can verify the token offline against /.well-known/jwks.json and read the documented claims.",
    ),
  },
  async () => {
    const user = await app.user("ana", { signIn: false });
    const login = await step("POST /auth/login with the right password", () =>
      app.api.post("/auth/login", { email: user.email, password: PASSWORD }),
    );
    await step("It answers 200 SIGNED_IN with both tokens and the user", async () => {
      expect(login.status).toBe(200);
      expect(login.message).toBe("SIGNED_IN");
      expect(login.data).toMatchObject({
        tokenType: "Bearer",
        expiresIn: 900,
        user: { id: user.id, email: user.email, emailVerified: true },
      });
      expect(login.data.refreshToken).toMatch(/^dgr_[\w-]{43}$/);
      expect(login.data.user.lastSignInAt).toEqual(expect.any(String));
    });
    const token: string = login.data.accessToken;
    await step("The header names ES256 and a key in the key set", async () => {
      const jwks = await app.api.get("/.well-known/jwks.json");
      expect(jwks.status).toBe(200);
      expect(jwtHeader(token)).toMatchObject({ alg: "ES256", typ: "JWT" });
      expect(await verifiedByJwks(token, jwks.body)).toBe(true);
    });
    await step("The claims match the documentation", async () => {
      const body = claims(token);
      expect(body.iss).toBe(app.url);
      expect(body.aud).toBe(app.url);
      expect(body.sub).toBe(user.id);
      expect(body.kind).toBe("human");
      expect(body.email).toBe(user.email);
      expect(body.email_verified).toBe(true);
      expect(body.sid).toMatch(/^ses_/);
      expect(body.jti).toMatch(/^jti_/);
      expect(body.exp - body.iat).toBe(900);
      expect(body).not.toHaveProperty("public_metadata");
      expect(body).not.toHaveProperty("via");
      expect(body).not.toHaveProperty("tid");
    });
    await step("A tampered token fails the signature check", async () => {
      const [head, payload, signature] = token.split(".");
      const forged = Buffer.from(
        JSON.stringify({ ...claims(token), sub: "usr_FORGED" }),
      ).toString("base64url");
      const jwks = await app.api.get("/.well-known/jwks.json");
      expect(await verifiedByJwks(`${head}.${forged}.${signature}`, jwks.body)).toBe(false);
      expect(payload).not.toBe(forged);
      const refused = await app.api.get("/auth/me", { token: `${head}.${forged}.${signature}` });
      expect(refused.status).toBe(401);
    });
    await step("Every sign-in gets its own token ID and session", async () => {
      const second = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
      const other: string = second.data.accessToken;
      expect(claims(other).jti).not.toBe(claims(token).jti);
      expect(sessionOf(other)).not.toBe(sessionOf(token));
    });
    await step("The audit log records user.signed_in with the session", async () => {
      const events = await auditEvents(app, "user.signed_in", user.email);
      expect(events[1]).toMatchObject({
        actorType: "user",
        actorId: user.id,
        metadata: { method: "password", sessionId: sessionOf(token) },
      });
    });
  },
);

test(
  "public metadata travels in the access token only when it is set",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "An account with publicMetadata gets it as the public_metadata claim at sign-in. An account without it has no such claim. Private metadata never appears in the token.",
    ),
  },
  async () => {
    const plain = await app.user("plain");
    const manager = await app.user("manager", {
      publicMetadata: { role: "manager", seats: 3 },
      privateMetadata: { stripeCustomerId: "cus_123" },
    });
    await step("A user with publicMetadata has it in the token", async () => {
      const body = claims(manager.tokens!.accessToken);
      expect(body.public_metadata).toEqual({ role: "manager", seats: 3 });
      expect(JSON.stringify(body)).not.toContain("cus_123");
    });
    await step("A user without it has no claim", async () => {
      expect(claims(plain.tokens!.accessToken)).not.toHaveProperty("public_metadata");
    });
    await step("A backend change reaches the next refreshed token", async () => {
      await app.service.must(
        "PATCH",
        `/admin/users/${plain.id}`,
        { publicMetadata: { plan: "pro" } },
        { record: false },
      );
      const refreshed = await plain.api.post("/auth/refresh", {
        refreshToken: plain.tokens!.refreshToken,
      });
      expect(claims(refreshed.data.accessToken).public_metadata).toEqual({ plan: "pro" });
      expect(claims(plain.tokens!.accessToken)).not.toHaveProperty("public_metadata");
    });
  },
);

test(
  "a wrong password and an unknown email get the same answer",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "Sign-in does not say which emails have accounts. Both failures answer 401 AUTHENTICATION_INVALID with the same message, and only the real account leaves a sign_in_failed event.",
    ),
  },
  async () => {
    const user = await app.user("careful", { signIn: false });
    const wrong = await step("POST /auth/login with a wrong password", () =>
      app.api.post("/auth/login", { email: user.email, password: "not the password" }),
    );
    const unknown = await step("POST /auth/login with an email nobody has", () =>
      app.api.post("/auth/login", { email: app.email("nobody"), password: PASSWORD }),
    );
    await step("Both are 401 with the same code and message", async () => {
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.code).toBe("AUTHENTICATION_INVALID");
      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.setCookies).toEqual([]);
    });
    await step("A missing password is a malformed request", async () => {
      const result = await app.api.post("/auth/login", { email: user.email });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("The email is matched in any case", async () => {
      const result = await app.api.post("/auth/login", {
        email: user.email.toUpperCase(),
        password: PASSWORD,
      });
      expect(result.status).toBe(200);
    });
    await step("Only the real account has a sign_in_failed event", async () => {
      const failed = await auditEvents(app, "user.sign_in_failed", user.email);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        actorType: "user",
        actorId: user.id,
        metadata: { reason: "password", locked: false },
      });
    });
  },
);

test(
  "an unverified or disabled account is only reported after the right password",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "EMAIL_NOT_VERIFIED and ACCOUNT_DISABLED tell the caller the password was right. With a wrong password both accounts answer AUTHENTICATION_INVALID, so a stranger learns nothing about them.",
    ),
  },
  async () => {
    const pending = await app.user("pending", { verified: false });
    const off = await app.user("off", { signIn: true });
    await app.service.must("POST", `/admin/users/${off.id}/disable`, undefined, {
      record: false,
    });
    await step("The right password on an unverified email is 403 EMAIL_NOT_VERIFIED", async () => {
      const result = await app.api.post("/auth/login", { email: pending.email, password: PASSWORD });
      expect(result.status).toBe(403);
      expect(result.code).toBe("EMAIL_NOT_VERIFIED");
      expect(result.body.error.EMAIL_NOT_VERIFIED).toContain("Confirm your email");
    });
    await step("The right password on a disabled account is 403 ACCOUNT_DISABLED", async () => {
      const result = await app.api.post("/auth/login", { email: off.email, password: PASSWORD });
      expect(result.status).toBe(403);
      expect(result.code).toBe("ACCOUNT_DISABLED");
    });
    await step("A wrong password on either is 401 AUTHENTICATION_INVALID", async () => {
      for (const email of [pending.email, off.email]) {
        const result = await app.api.post("/auth/login", { email, password: "nope nope nope" });
        expect(result.status).toBe(401);
        expect(result.code).toBe("AUTHENTICATION_INVALID");
      }
    });
    await step("With confirmation not required the unverified user signs in", async () => {
      await withSettings(app, "signup", { requireEmailVerification: false }, async () => {
        const result = await app.api.post("/auth/login", { email: pending.email, password: PASSWORD });
        expect(result.status).toBe(200);
        expect(result.data.user.emailVerified).toBe(false);
      });
    });
    await step("Enabling the account lets the user in again", async () => {
      await app.service.must("POST", `/admin/users/${off.id}/enable`, undefined, { record: false });
      const result = await app.api.post("/auth/login", { email: off.email, password: PASSWORD });
      expect(result.status).toBe(200);
    });
  },
);

test(
  "an admin's credentials do not work on the app sign-in",
  {
    tag: ["@auth", "@security", "@admins"],
    annotation: about(
      "Admins and users are separate accounts. The root email and password sent to /auth/login get the same 401 as a wrong password, and a console token is refused on user routes.",
    ),
  },
  async () => {
    const wrong = await app.api.post("/auth/login", {
      email: app.email("nobody"),
      password: PASSWORD,
    });
    await step("POST /auth/login with the root email and password is a plain 401", async () => {
      const result = await app.api.post("/auth/login", { email: ROOT_EMAIL, password: PASSWORD });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
      expect(result.body).toEqual(wrong.body);
    });
    await step("A second admin gets the same answer", async () => {
      const admin = await app.admin("sam");
      const result = await app.api.post("/auth/login", { email: admin.email, password: PASSWORD });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("A console token on GET /auth/me is 403 AUTHORIZATION_DENIED", async () => {
      const root = await app.root();
      const result = await app.api.get("/auth/me", { token: root.tokens.accessToken });
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
  },
);

test(
  "cookie mode puts the refresh token in an HttpOnly cookie",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A client on Dopgate's own origin can ask for the refresh token in a cookie. The body then has refreshToken null, the cookie is HttpOnly, SameSite=Strict and limited to /api/v1/auth, and refresh and logout can use it alone.",
    ),
  },
  async () => {
    const user = await app.user("cookie", { signIn: false });
    const api = await app.newApi("browser");
    const login = await step("POST /auth/login with the cookie header", () =>
      api.post("/auth/login", { email: user.email, password: PASSWORD }, { headers: COOKIE_MODE }),
    );
    await step("The body has no refresh token", async () => {
      expect(login.status).toBe(200);
      expect(login.data.refreshToken).toBeNull();
      expect(login.data.accessToken).toEqual(expect.any(String));
      expect(JSON.stringify(login.body)).not.toContain("dgr_");
    });
    await step("The cookie is HttpOnly, SameSite=Strict and scoped to /api/v1/auth", async () => {
      expect(login.setCookies).toHaveLength(1);
      const cookie = login.setCookies[0]!;
      expect(cookie).toMatch(/^dopgate_refresh=dgr_/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Path=/api/v1/auth");
      expect(cookie).toContain("Max-Age=2592000");
      expect(cookie).not.toContain("Secure");
    });
    await step("Without the header the refresh token is in the body and no cookie is set", async () => {
      const plain = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
      expect(plain.data.refreshToken).toMatch(/^dgr_/);
      expect(plain.setCookies).toEqual([]);
    });
  },
);

test(
  "wrong passwords lock the account, a code still signs in, and a reset unlocks it",
  {
    tag: ["@auth", "@security", "@limits"],
    annotation: about(
      "After limits.lockoutAttempts wrong passwords the account locks. Even the right password gets AUTHENTICATION_INVALID, the audit log tells locked from wrong, an emailed code still works, and a password reset clears the lock.",
    ),
  },
  async () => {
    const user = await app.user("locked", { signIn: false });
    const attempt = (password: string) =>
      app.api.post("/auth/login", { email: user.email, password });
    await withSettings(app, "limits", { lockoutAttempts: 3 }, async () => {
      await step("Two wrong passwords are plain misses", async () => {
        for (let i = 0; i < 2; i++) {
          expect((await attempt("wrong password")).code).toBe("AUTHENTICATION_INVALID");
        }
        const stored = await app.service.get(`/admin/users/${user.id}`, { record: false });
        expect(stored.data.lockedUntil).toBeNull();
      });
      await step("The third wrong password locks the account", async () => {
        expect((await attempt("wrong password")).status).toBe(401);
        const stored = await app.service.get(`/admin/users/${user.id}`, { record: false });
        expect(stored.data.lockedUntil).toEqual(expect.any(String));
      });
      await step("The right password is refused with the same answer", async () => {
        const locked = await attempt(PASSWORD);
        expect(locked.status).toBe(401);
        expect(locked.code).toBe("AUTHENTICATION_INVALID");
        expect(locked.body).toEqual((await attempt("wrong password")).body);
      });
      await step("The audit log tells a lockout from a miss", async () => {
        const failed = await auditEvents(app, "user.sign_in_failed", user.email);
        const misses = failed.filter((event) => event.metadata.reason === "password");
        expect(misses).toHaveLength(3);
        expect(misses.filter((event) => event.metadata.locked === true)).toHaveLength(1);
        // The right password and the extra miss while locked.
        expect(failed.filter((event) => event.metadata.reason === "locked")).toHaveLength(2);
      });
      await step("An emailed login code still signs in", async () => {
        await app.api.post("/auth/verification/send", { email: user.email, purpose: "login" });
        const code = await app.mail.code(user.email);
        const result = await app.api.post("/auth/verification/confirm", {
          email: user.email,
          purpose: "login",
          code,
        });
        expect(result.status).toBe(200);
      });
      await step("A password reset clears the lock", async () => {
        const before = await app.mail.count(user.email);
        await app.api.post("/auth/password/forgot", { email: user.email });
        await app.mail.last(user.email, { after: before });
        const reset = await app.api.post("/auth/password/reset", {
          email: user.email,
          code: await app.mail.code(user.email),
          newPassword: NEW_PASSWORD,
        });
        expect(reset.status).toBe(200);
        const stored = await app.service.get(`/admin/users/${user.id}`, { record: false });
        expect(stored.data.lockedUntil).toBeNull();
        const login = await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD });
        expect(login.status).toBe(200);
      });
    });
  },
);

test(
  "a successful sign-in starts the failed-password count over",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "Wrong passwords only lock the account when they come in a row. A good sign-in in between resets the count, so scattered typos never lock a person out.",
    ),
  },
  async () => {
    const user = await app.user("typos", { signIn: false });
    await withSettings(app, "limits", { lockoutAttempts: 3 }, async () => {
      for (let round = 0; round < 2; round++) {
        await step(`Round ${round + 1}: two wrong passwords, then the right one`, async () => {
          for (let i = 0; i < 2; i++) {
            await app.api.post("/auth/login", { email: user.email, password: "wrong again" });
          }
          const ok = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
          expect(ok.status).toBe(200);
        });
      }
    });
  },
);

test(
  "an emailed login code signs in an existing user and verifies the email",
  {
    tag: ["@auth", "@smoke"],
    annotation: about(
      "A user who asks for a login code and confirms it gets tokens and a session with method otp. The code proves the inbox, so an unverified email becomes verified. Accounts with no password can sign in this way.",
    ),
  },
  async () => {
    const pending = await app.user("pending", { verified: false });
    const codeOnly = await app.user("codeonly", { password: false });
    const sendAndConfirm = async (email: string, extra: Record<string, unknown> = {}) => {
      const before = await app.mail.count(email);
      const sent = await app.api.post("/auth/verification/send", { email, purpose: "login" });
      expect(sent.message).toBe("CODE_SENT");
      await app.mail.last(email, { after: before });
      return app.api.post(
        "/auth/verification/confirm",
        { email, purpose: "login", code: await app.mail.code(email), ...extra },
      );
    };
    await step("The mail is a sign-in code", async () => {
      await app.api.post("/auth/verification/send", { email: pending.email, purpose: "login" });
      const mail = await app.mail.last(pending.email);
      expect(mail.subject).toMatch(/\b\d{6}\b/);
      expect(mail.text).toContain("sign in");
    });
    const confirmed = await step("POST /auth/verification/confirm with purpose login", async () =>
      app.api.post("/auth/verification/confirm", {
        email: pending.email.toUpperCase(),
        purpose: "login",
        code: await app.mail.code(pending.email),
      }),
    );
    await step("It answers 200 SIGNED_IN with tokens and a verified email", async () => {
      expect(confirmed.status).toBe(200);
      expect(confirmed.message).toBe("SIGNED_IN");
      expect(confirmed.data.refreshToken).toMatch(/^dgr_/);
      expect(confirmed.data.user).toMatchObject({ id: pending.id, emailVerified: true });
    });
    await step("The session's method is otp", async () => {
      const api = await app.newApi("otp");
      const sessions = await api.get("/auth/sessions", { token: confirmed.data.accessToken });
      expect(sessions.data).toHaveLength(1);
      expect(sessions.data[0]).toMatchObject({ method: "otp", current: true });
      const events = await auditEvents(app, "user.signed_in", pending.email);
      expect(events[0]!.metadata.method).toBe("otp");
    });
    await step("Password sign-in works now that the email is verified", async () => {
      const login = await app.api.post("/auth/login", { email: pending.email, password: PASSWORD });
      expect(login.status).toBe(200);
    });
    await step("A user without a password signs in with a code", async () => {
      const result = await sendAndConfirm(codeOnly.email);
      expect(result.status).toBe(200);
      expect(result.data.user).toMatchObject({ id: codeOnly.id, hasPassword: false });
    });
    await step("That user cannot sign in with a password", async () => {
      const result = await app.api.post("/auth/login", { email: codeOnly.email, password: PASSWORD });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("Cookie mode works with a code too", async () => {
      const api = await app.newApi("otp-cookie");
      const before = await app.mail.count(codeOnly.email);
      await api.post("/auth/verification/send", { email: codeOnly.email, purpose: "login" });
      await app.mail.last(codeOnly.email, { after: before });
      const result = await api.post(
        "/auth/verification/confirm",
        { email: codeOnly.email, purpose: "login", code: await app.mail.code(codeOnly.email) },
        { headers: COOKIE_MODE },
      );
      expect(result.data.refreshToken).toBeNull();
      expect(result.setCookies[0]).toMatch(/^dopgate_refresh=dgr_/);
    });
  },
);

test(
  "a login code is only good for its own purpose, its own email and an active account",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A login code cannot be used as an email_verify code, nor for another address. A wrong code counts down tries. If the account is disabled after the code went out, confirming answers ACCOUNT_DISABLED.",
    ),
  },
  async () => {
    const user = await app.user("strict", { verified: false });
    const other = await app.user("other");
    const send = async (email: string, purpose: string) => {
      const before = await app.mail.count(email);
      await app.api.post("/auth/verification/send", { email, purpose });
      await app.mail.last(email, { after: before });
      return app.mail.code(email);
    };
    const confirm = (email: string, purpose: string, code: string) =>
      app.api.post("/auth/verification/confirm", { email, purpose, code });
    const code = await send(user.email, "login");
    await step("The login code does not confirm as email_verify", async () => {
      const result = await confirm(user.email, "email_verify", code);
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
    });
    await step("The login code does not work for another email", async () => {
      const result = await confirm(other.email, "login", code);
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
    });
    await step("A wrong code says how many tries are left", async () => {
      const result = await confirm(user.email, "login", wrongCode(code));
      expect(result.body.error.CODE_INVALID).toBe("That code is wrong. 4 tries left.");
    });
    await step("An email_verify code does not sign in as login", async () => {
      const verifyCode = await send(user.email, "email_verify");
      expect((await confirm(user.email, "login", verifyCode)).code).toBe("CODE_INVALID");
      expect((await confirm(user.email, "email_verify", verifyCode)).status).toBe(200);
    });
    await step("A disabled account gets 403 ACCOUNT_DISABLED when it confirms", async () => {
      const fresh = await send(other.email, "login");
      await app.service.must("POST", `/admin/users/${other.id}/disable`, undefined, { record: false });
      const result = await confirm(other.email, "login", fresh);
      expect(result.status).toBe(403);
      expect(result.code).toBe("ACCOUNT_DISABLED");
    });
    await step("A disabled account is sent no new code", async () => {
      const before = await app.mail.count(other.email);
      const sent = await app.api.post("/auth/verification/send", { email: other.email, purpose: "login" });
      expect(sent.message).toBe("CODE_SENT");
      const probe = await app.user("probe");
      await app.api.post("/auth/verification/send", { email: probe.email, purpose: "login" });
      await app.mail.code(probe.email);
      expect(await app.mail.count(other.email)).toBe(before);
    });
  },
);

test(
  "passwordless sign-up creates an account from a login code when it is switched on",
  {
    tag: ["@auth", "@settings"],
    annotation: about(
      "With signup.passwordlessSignup on, a login code also goes to an email with no account. Confirming it creates a verified user with no password. With it off, or with sign-up closed, nothing is sent and confirming gives CODE_INVALID.",
    ),
  },
  async () => {
    const confirm = (email: string, code: string) =>
      app.api.post("/auth/verification/confirm", { email, purpose: "login", code });
    await step("By default an unknown email gets no code and no account", async () => {
      const email = app.email("stranger");
      const probe = await app.user("probe-a");
      await app.api.post("/auth/verification/send", { email, purpose: "login" });
      await app.api.post("/auth/verification/send", { email: probe.email, purpose: "login" });
      await app.mail.code(probe.email);
      expect(await app.mail.count(email)).toBe(0);
      expect((await confirm(email, "123456")).code).toBe("CODE_INVALID");
    });
    await withSettings(app, "signup", { passwordlessSignup: true }, async () => {
      const email = app.email("newcomer");
      await step("POST /auth/verification/send for an unknown email sends a code", async () => {
        const sent = await app.api.post("/auth/verification/send", { email, purpose: "login" });
        expect(sent.message).toBe("CODE_SENT");
        expect(await app.mail.code(email)).toMatch(/^\d{6}$/);
      });
      const result = await step("Confirming it creates the account and signs in", async () =>
        confirm(email, await app.mail.code(email)),
      );
      await step("The user is verified, has no password and a usr_ ID", async () => {
        expect(result.status).toBe(200);
        expect(result.data.user).toMatchObject({
          email,
          emailVerified: true,
          hasPassword: false,
        });
        expect(result.data.user.id).toMatch(/^usr_/);
        expect(claims(result.data.accessToken).sub).toBe(result.data.user.id);
      });
      await step("The audit log records user.signed_up with method otp", async () => {
        const events = await auditEvents(app, "user.signed_up", email);
        expect(events).toHaveLength(1);
        expect(events[0]!.metadata).toMatchObject({ method: "otp" });
      });
      await step("The account is an ordinary user afterwards", async () => {
        const stored = await app.service.get(`/admin/users/${result.data.user.id}`, { record: false });
        expect(stored.data).toMatchObject({ email, status: "active", emailVerified: true });
      });
      await step("With sign-up closed no code is sent to an unknown email", async () => {
        await withSettings(app, "signup", { enabled: false }, async () => {
          const closed = app.email("closed");
          const probe = await app.user("probe-b");
          await app.api.post("/auth/verification/send", { email: closed, purpose: "login" });
          await app.api.post("/auth/verification/send", { email: probe.email, purpose: "login" });
          await app.mail.code(probe.email);
          expect(await app.mail.count(closed)).toBe(0);
        });
      });
    });
  },
);
