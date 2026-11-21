import {
  about,
  COOKIE_MODE,
  expect,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims, jwtHeader, verifiedByJwks } from "../harness/helpers.ts";
import {
  addAdmin,
  audit,
  auditEvent,
  cookieValue,
  emailedLoginCode,
  expectError,
  lockOut,
  OTHER_PASSWORD,
  PASSWORD,
  ROOT_EMAIL,
  setCookie,
  WRONG_CREDENTIALS,
} from "./console.support.ts";

const app = useServer();

test(
  "root signs in to the console and gets console tokens",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "A password sign-in on /console/login answers with an admin, not a user. The access token is an HS256 JWT for the console audience, and its signing key is not in the public key set.",
    ),
  },
  async () => {
    const signedIn = await step("POST /console/login as root", () =>
      app.api.post("/console/login", { email: ROOT_EMAIL, password: PASSWORD }),
    );
    await step("It answers SIGNED_IN with tokens and the admin", async () => {
      expect(signedIn.status).toBe(200);
      expect(signedIn.message).toBe("SIGNED_IN");
      expect(signedIn.data.tokenType).toBe("Bearer");
      expect(signedIn.data.expiresIn).toBe(900);
      expect(signedIn.data.refreshToken).toMatch(/^dgr_/);
      expect(signedIn.data.admin).toMatchObject({
        email: ROOT_EMAIL,
        role: "root",
        status: "active",
        hasPassword: true,
      });
      expect(signedIn.data.admin.id).toMatch(/^adm_/);
    });
    await step("It carries an admin and no user", async () => {
      expect(signedIn.data.user).toBeUndefined();
    });
    const token: string = signedIn.data.accessToken;
    await step("The access token is HS256 for the console audience", async () => {
      expect(jwtHeader(token).alg).toBe("HS256");
      expect(claims(token)).toMatchObject({
        aud: "dopgate-console",
        role: "root",
        email: ROOT_EMAIL,
        sub: signedIn.data.admin.id,
      });
      expect(claims(token).sid).toMatch(/^ses_/);
    });
    await step("Its kid is not in GET /.well-known/jwks.json", async () => {
      const jwks = await app.api.get("/.well-known/jwks.json");
      const kids = jwks.body.keys.map((key: { kid: string }) => key.kid);
      expect(jwtHeader(token).kid).toMatch(/^ckey_/);
      expect(kids).not.toContain(jwtHeader(token).kid);
      expect(await verifiedByJwks(token, jwks.body)).toBe(false);
    });
    await step("GET /console/me accepts the token", async () => {
      const me = await app.api.get("/console/me", { token });
      expect(me.status).toBe(200);
      expect(me.data.email).toBe(ROOT_EMAIL);
    });
    await step("The sign-in is in the audit log as admin.signed_in", async () => {
      const event = await auditEvent(
        app,
        "admin.signed_in",
        (e) => e.metadata.sessionId === claims(token).sid,
      );
      expect(event).toMatchObject({
        actorType: "root",
        actorLabel: ROOT_EMAIL,
        resourceType: "admin",
        metadata: { method: "password" },
      });
    });
  },
);

test(
  "a wrong password, an unknown email and a user's credentials get one answer",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "The console never says whether an email belongs to an admin. A wrong password, an email nobody uses, and a user of the app who tries to sign in all get the same 401, and a failed attempt on a real admin leaves an audit event.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "twin" });
    const user = await app.service.post(
      "/admin/users",
      { email: admin.email, password: OTHER_PASSWORD, emailVerified: true },
      { record: false },
    );
    expect(user.status).toBe(201);
    const wrong = await step("POST /console/login with a wrong password", () =>
      app.api.post("/console/login", {
        email: admin.email,
        password: "not the right password",
      }),
    );
    const nobody = app.email("nobody");
    const unknown = await step("POST /console/login with an unknown email", () =>
      app.api.post("/console/login", {
        email: nobody,
        password: "not the right password",
      }),
    );
    const asUser = await step(
      "POST /console/login with the password of a user who has the admin's email",
      () =>
        app.api.post("/console/login", {
          email: admin.email,
          password: OTHER_PASSWORD,
        }),
    );
    await step("All three answer 401 AUTHENTICATION_INVALID alike", async () => {
      for (const result of [wrong, unknown, asUser]) {
        expectError(result, WRONG_CREDENTIALS.status, WRONG_CREDENTIALS.code);
      }
      expect(unknown.body).toEqual(wrong.body);
      expect(asUser.body).toEqual(wrong.body);
    });
    await step("The user can sign in to the app with that password", async () => {
      const login = await app.api.post("/auth/login", {
        email: admin.email,
        password: OTHER_PASSWORD,
      });
      expect(login.status).toBe(200);
      expect(login.data.user.email).toBe(admin.email);
    });
    await step("The admin's password does not open the app", async () => {
      const login = await app.api.post("/auth/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(login, 401, "AUTHENTICATION_INVALID");
    });
    await step("The admin's failed attempts are audited, the unknown email's are not", async () => {
      const failed = await auditEvent(
        app,
        "admin.sign_in_failed",
        (e) => e.actorLabel === admin.email,
      );
      expect(failed.metadata).toMatchObject({ reason: "password", locked: false });
      const unknownEvents = (await audit(app, "admin.sign_in_failed")).filter(
        (e) => e.actorLabel === nobody,
      );
      expect(unknownEvents).toEqual([]);
    });
  },
);

test(
  "a sign-in without a password is a bad request",
  {
    tag: ["@console"],
    annotation: about(
      "A body that lacks a field fails with REQUEST_INVALID before any account is looked up. An email that isn't one is just a wrong login.",
    ),
  },
  async () => {
    await step("POST /console/login without a password", async () => {
      const result = await app.api.post("/console/login", { email: ROOT_EMAIL });
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("POST /console/login with an email that is not one", async () => {
      const result = await app.api.post("/console/login", {
        email: "not-an-email",
        password: PASSWORD,
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
  },
);

test(
  "console tokens and app tokens only work on their own side",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "An admin's console token is refused by the app's endpoints, and a user's access token is refused by the console's. The service key has no account on either side.",
    ),
  },
  async () => {
    const admin = await app.admin("sam");
    const user = await app.user("ana");
    await step("GET /auth/me with an admin's console token", async () => {
      expectError(await admin.api.get("/auth/me"), 403, "AUTHORIZATION_DENIED");
    });
    await step("GET /auth/sessions with an admin's console token", async () => {
      expectError(
        await admin.api.get("/auth/sessions"),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
    await step("GET /console/me with a user's access token", async () => {
      expectError(
        await user.api.get("/console/me"),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
    await step("GET /console/sessions with a user's access token", async () => {
      expectError(
        await user.api.get("/console/sessions"),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
    await step("GET /console/me with the service key", async () => {
      expectError(
        await app.service.get("/console/me"),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
    await step("Each token still works at home", async () => {
      expect((await admin.api.get("/console/me")).data.email).toBe(admin.email);
      expect((await user.api.get("/auth/me")).data.email).toBe(user.email);
    });
  },
);

test(
  "cookie mode keeps the console session in the dopgate_console cookie",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "With X-Dopgate-Session: cookie the refresh token goes into an HttpOnly cookie that is limited to the console's path, and the console can refresh with the cookie alone.",
    ),
  },
  async () => {
    const browser = await app.newApi("browser");
    const signedIn = await step(
      "POST /console/login with X-Dopgate-Session: cookie",
      () =>
        browser.post(
          "/console/login",
          { email: ROOT_EMAIL, password: PASSWORD },
          { headers: COOKIE_MODE },
        ),
    );
    await step("The body has no refresh token", async () => {
      expect(signedIn.status).toBe(200);
      expect(signedIn.data.refreshToken).toBeNull();
      expect(signedIn.data.accessToken).toBeTruthy();
    });
    const first = await step("The cookie is HttpOnly, Strict and limited to /api/v1/console", async () => {
      const header = setCookie(signedIn.setCookies, "dopgate_console");
      expect(header).toBeTruthy();
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Strict");
      expect(header).toContain("Path=/api/v1/console");
      expect(header).not.toContain("Secure");
      expect(setCookie(signedIn.setCookies, "dopgate_refresh")).toBeUndefined();
      return cookieValue(header!);
    });
    expect(first).toMatch(/^dgr_/);
    const refreshed = await step("POST /console/refresh with only the cookie", () =>
      browser.post("/console/refresh", undefined, {
        headers: COOKIE_MODE,
        token: null,
      }),
    );
    await step("It answers TOKENS_REFRESHED and sets a new cookie", async () => {
      expect(refreshed.status).toBe(200);
      expect(refreshed.message).toBe("TOKENS_REFRESHED");
      expect(refreshed.data.refreshToken).toBeNull();
      expect(refreshed.data.admin.role).toBe("root");
      const next = cookieValue(
        setCookie(refreshed.setCookies, "dopgate_console")!,
      );
      expect(next).toMatch(/^dgr_/);
      expect(next).not.toBe(first);
      expect(await browser.cookie("dopgate_console")).toBe(next);
    });
    await step("The new access token works", async () => {
      const me = await browser.get("/console/me", {
        token: refreshed.data.accessToken,
      });
      expect(me.status).toBe(200);
    });
  },
);

test(
  "the app's refresh endpoint does not take a console refresh token",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "Console and app sessions are separate. A refresh token from one side is unknown to the other, in both directions.",
    ),
  },
  async () => {
    const admin = await app.admin("pia");
    const user = await app.user("lee");
    await step("POST /auth/refresh with a console refresh token", async () => {
      const result = await app.api.post("/auth/refresh", {
        refreshToken: admin.tokens.refreshToken,
      });
      expectError(result, 401, "TOKEN_INVALID");
    });
    await step("POST /console/refresh with a user's refresh token", async () => {
      const result = await app.api.post("/console/refresh", {
        refreshToken: user.tokens!.refreshToken,
      });
      expectError(result, 401, "TOKEN_INVALID");
    });
    await step("POST /console/refresh with nothing", async () => {
      const result = await app.api.post("/console/refresh", {});
      expectError(result, 401, "TOKEN_INVALID");
    });
    await step("POST /console/refresh with a made-up token", async () => {
      const result = await app.api.post("/console/refresh", {
        refreshToken: "dgr_not-a-real-token",
      });
      expectError(result, 401, "TOKEN_INVALID");
    });
  },
);

test(
  "refresh swaps the refresh token for a new pair",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "Each refresh spends the old refresh token and hands out a new access token and a new refresh token for the same session.",
    ),
  },
  async () => {
    const admin = await app.admin("rue");
    const sid = claims(admin.tokens.accessToken).sid;
    const refreshed = await step("POST /console/refresh with the refresh token", () =>
      app.api.post("/console/refresh", {
        refreshToken: admin.tokens.refreshToken,
      }),
    );
    await step("It answers TOKENS_REFRESHED with a new pair for the same session", async () => {
      expect(refreshed.status).toBe(200);
      expect(refreshed.message).toBe("TOKENS_REFRESHED");
      expect(refreshed.data.refreshToken).toMatch(/^dgr_/);
      expect(refreshed.data.refreshToken).not.toBe(admin.tokens.refreshToken);
      expect(claims(refreshed.data.accessToken).sid).toBe(sid);
      expect(refreshed.data.admin.email).toBe(admin.email);
    });
    await step("The new access token works", async () => {
      const me = await app.api.get("/console/me", {
        token: refreshed.data.accessToken,
      });
      expect(me.data.email).toBe(admin.email);
    });
    await step("Presenting the old token at once gets the newest one", async () => {
      const again = await app.api.post("/console/refresh", {
        refreshToken: admin.tokens.refreshToken,
      });
      expect(again.status).toBe(200);
      expect(again.data.refreshToken).toBe(refreshed.data.refreshToken);
    });
  },
);

test(
  "a spent refresh token that comes back late ends the session",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "With the reuse window turned off, a spent refresh token that is presented again means two parties hold it, so Dopgate ends the whole session and records session.refresh_reused.",
    ),
  },
  async () => {
    const admin = await app.admin("ivo");
    const sid = claims(admin.tokens.accessToken).sid;
    await app.settings("tokens", { refreshReuseSeconds: 0 });
    try {
      const next = await step("POST /console/refresh once", () =>
        app.api.post("/console/refresh", {
          refreshToken: admin.tokens.refreshToken,
        }),
      );
      expect(next.status).toBe(200);
      await step("POST /console/refresh with the spent token again", async () => {
        const replay = await app.api.post("/console/refresh", {
          refreshToken: admin.tokens.refreshToken,
        });
        expectError(replay, 401, "TOKEN_INVALID");
      });
      await step("The newest refresh token and access token are dead too", async () => {
        const again = await app.api.post("/console/refresh", {
          refreshToken: next.data.refreshToken,
        });
        expectError(again, 401, "TOKEN_INVALID");
        const me = await app.api.get("/console/me", {
          token: next.data.accessToken,
        });
        expectError(me, 401, "TOKEN_INVALID");
      });
      await step("The reuse is in the audit log", async () => {
        const event = await auditEvent(
          app,
          "session.refresh_reused",
          (e) => e.resourceId === sid,
        );
        expect(event.actorType).toBe("anonymous");
        expect(event.metadata.accountId).toBe(admin.id);
      });
    } finally {
      await app.settings("tokens", { refreshReuseSeconds: 10 });
    }
  },
);

test(
  "logout with the access token ends that session and no other",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "Signing out on one device ends its session only. The same admin's other session keeps working.",
    ),
  },
  async () => {
    const admin = await app.admin("dot");
    const other = await app.consoleSession(admin.email);
    const out = await step("POST /console/logout with the access token", () =>
      admin.api.post("/console/logout"),
    );
    await step("It answers SIGNED_OUT with no data", async () => {
      expect(out.status).toBe(200);
      expect(out.message).toBe("SIGNED_OUT");
      expect(out.data).toBeNull();
    });
    await step("The access and refresh tokens of that session stop working", async () => {
      expectError(await admin.api.get("/console/me"), 401, "TOKEN_INVALID");
      const refresh = await app.api.post("/console/refresh", {
        refreshToken: admin.tokens.refreshToken,
      });
      expectError(refresh, 401, "TOKEN_INVALID");
    });
    await step("The other session still works", async () => {
      expect((await other.api.get("/console/me")).status).toBe(200);
    });
    await step("The sign-out is audited with allSessions false", async () => {
      const event = await auditEvent(
        app,
        "admin.signed_out",
        (e) => e.actorLabel === admin.email,
      );
      expect(event.metadata.allSessions).toBe(false);
      expect(event.metadata.sessionId).toBe(claims(admin.tokens.accessToken).sid);
    });
  },
);

test(
  "logout works with only a refresh token",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "Once the access token has expired the console can still sign out with the refresh token. An unknown refresh token still answers 200, and a call with neither token is refused.",
    ),
  },
  async () => {
    const admin = await app.admin("kai");
    await step("POST /console/logout with the refresh token and no access token", async () => {
      const out = await app.api.post("/console/logout", {
        refreshToken: admin.tokens.refreshToken,
      });
      expect(out.status).toBe(200);
      expect(out.message).toBe("SIGNED_OUT");
    });
    await step("The session is gone", async () => {
      expectError(await admin.api.get("/console/me"), 401, "TOKEN_INVALID");
      const refresh = await app.api.post("/console/refresh", {
        refreshToken: admin.tokens.refreshToken,
      });
      expectError(refresh, 401, "TOKEN_INVALID");
    });
    await step("POST /console/logout with an unknown refresh token", async () => {
      const out = await app.api.post("/console/logout", {
        refreshToken: "dgr_never-issued",
      });
      expect(out.status).toBe(200);
    });
    await step("POST /console/logout with no token at all", async () => {
      const out = await app.api.post("/console/logout", {});
      expectError(out, 401, "AUTHENTICATION_REQUIRED");
    });
  },
);

test(
  "logout with allSessions ends every session of the admin",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "One call with allSessions: true signs the admin out of every device. Another admin's sessions are untouched.",
    ),
  },
  async () => {
    const admin = await app.admin("eli");
    const second = await app.consoleSession(admin.email);
    const third = await app.consoleSession(admin.email);
    const bystander = await app.admin("fay");
    await step("POST /console/logout with allSessions", async () => {
      const out = await admin.api.post("/console/logout", { allSessions: true });
      expect(out.status).toBe(200);
      expect(out.message).toBe("SIGNED_OUT");
    });
    await step("All three sessions are gone", async () => {
      for (const session of [admin, second, third]) {
        expectError(await session.api.get("/console/me"), 401, "TOKEN_INVALID");
      }
    });
    await step("Another admin is still signed in", async () => {
      expect((await bystander.api.get("/console/me")).status).toBe(200);
    });
    await step("The audit event says allSessions", async () => {
      const event = await auditEvent(
        app,
        "admin.signed_out",
        (e) => e.actorLabel === admin.email && e.metadata.allSessions === true,
      );
      expect(event.actorType).toBe("admin");
    });
  },
);

test(
  "console logout clears its own cookie and leaves the app's cookie alone",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "One browser can hold a user's dopgate_refresh cookie and an admin's dopgate_console cookie. Signing out of the console clears only the console one, and the user's session still refreshes.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "cookie" });
    const user = await app.user("browser");
    const browser = await app.newApi("browser");
    await step("The browser signs in as a user and as an admin, both in cookie mode", async () => {
      const asUser = await browser.post(
        "/auth/login",
        { email: user.email, password: PASSWORD },
        { headers: COOKIE_MODE, record: false },
      );
      expect(asUser.status).toBe(200);
      const asAdmin = await browser.post(
        "/console/login",
        { email: admin.email, password: PASSWORD },
        { headers: COOKIE_MODE },
      );
      expect(asAdmin.status).toBe(200);
      expect(await browser.cookie("dopgate_refresh")).toMatch(/^dgr_/);
      expect(await browser.cookie("dopgate_console")).toMatch(/^dgr_/);
    });
    await step("POST /console/logout with the cookie only", async () => {
      const out = await browser.post("/console/logout", undefined, {
        headers: COOKIE_MODE,
        token: null,
      });
      expect(out.status).toBe(200);
      const cleared = setCookie(out.setCookies, "dopgate_console");
      expect(cleared).toContain("Max-Age=0");
      expect(cleared).toContain("Path=/api/v1/console");
      expect(setCookie(out.setCookies, "dopgate_refresh")).toBeUndefined();
    });
    await step("The console cookie is gone and the app's cookie is still there", async () => {
      expect(await browser.cookie("dopgate_console")).toBeFalsy();
      expect(await browser.cookie("dopgate_refresh")).toMatch(/^dgr_/);
    });
    await step("POST /auth/refresh with the app's cookie still works", async () => {
      const refreshed = await browser.post("/auth/refresh", undefined, {
        headers: COOKIE_MODE,
        token: null,
        record: false,
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.data.user.email).toBe(user.email);
    });
  },
);

test(
  "an admin without a password signs in by an emailed code",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "An admin root added without a password asks for a code on /console/codes/send and trades it on /console/codes/confirm for console tokens. The password route refuses them, and the app's confirm route does not take the code.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "code", password: false });
    await step("POST /console/login with a password is refused", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
    await step("POST /console/codes/send", async () => {
      const sent = await app.api.post("/console/codes/send", { email: admin.email });
      expect(sent.status).toBe(200);
      expect(sent.message).toBe("CODE_SENT");
      // Seconds until the next code. This server has the wait turned off.
      expect(sent.data).toEqual({ retryAfter: 0 });
    });
    const mail = await step("A sign-in code arrives by email", () =>
      app.mail.last(admin.email),
    );
    expect(mail.subject).toMatch(/sign-in code/i);
    const code = await app.mail.code(admin.email);
    await step("POST /auth/verification/confirm does not take it", async () => {
      const result = await app.api.post("/auth/verification/confirm", {
        email: admin.email,
        purpose: "login",
        code,
      });
      expectError(result, 400, "CODE_INVALID");
    });
    const confirmed = await step("POST /console/codes/confirm with purpose login", () =>
      app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code,
      }),
    );
    await step("It answers SIGNED_IN with console tokens for an admin", async () => {
      expect(confirmed.status).toBe(200);
      expect(confirmed.message).toBe("SIGNED_IN");
      expect(confirmed.data.admin).toMatchObject({
        email: admin.email,
        role: "admin",
        hasPassword: false,
      });
      expect(jwtHeader(confirmed.data.accessToken).alg).toBe("HS256");
      expect(claims(confirmed.data.accessToken).aud).toBe("dopgate-console");
      expect(confirmed.data.refreshToken).toMatch(/^dgr_/);
    });
    await step("The session is marked as an otp sign-in", async () => {
      const sessions = await app.api.get("/console/sessions", {
        token: confirmed.data.accessToken,
      });
      expect(sessions.data).toHaveLength(1);
      expect(sessions.data[0]).toMatchObject({ method: "otp", current: true });
      const event = await auditEvent(
        app,
        "admin.signed_in",
        (e) => e.actorLabel === admin.email,
      );
      expect(event.metadata.method).toBe("otp");
    });
    await step("The code works once", async () => {
      const again = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code,
      });
      expectError(again, 400, "CODE_INVALID");
    });
  },
);

test(
  "asking for a code gives the same answer for an unknown email and sends no mail",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "The send route never reveals which emails belong to admins. An unknown email, an email that only a user of the app has, and a bad email shape are told apart only by the shape.",
    ),
  },
  async () => {
    const user = await app.user("onlyuser");
    const stranger = app.email("stranger");
    const admin = await addAdmin(app, { name: "real" });
    const known = await step("POST /console/codes/send for a real admin", () =>
      app.api.post("/console/codes/send", { email: admin.email }),
    );
    const unknown = await step("POST /console/codes/send for an unknown email", () =>
      app.api.post("/console/codes/send", { email: stranger }),
    );
    const appUser = await step("POST /console/codes/send for a user of the app", () =>
      app.api.post("/console/codes/send", { email: user.email }),
    );
    await step("The three answers match", async () => {
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(appUser.body).toEqual(known.body);
    });
    await step("Only the admin got an email", async () => {
      await app.mail.last(admin.email);
      await expect
        .poll(async () => (await app.mail.to(stranger)).length)
        .toBe(0);
      const mails = (await app.mail.to(user.email)).filter((mail) =>
        /sign-in code/i.test(mail.subject),
      );
      expect(mails).toHaveLength(0);
    });
    await step("POST /console/codes/send with a bad email is refused", async () => {
      const result = await app.api.post("/console/codes/send", {
        email: "not-an-email",
      });
      expectError(result, 422, "EMAIL_INVALID");
    });
  },
);

test(
  "a wrong code is refused, counted, and used up after too many tries",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "Each wrong try on /console/codes/confirm says how many are left. After codeMaxAttempts wrong tries the code is dead, even with the right digits. A code for a purpose the console does not take is a bad request.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "tries", password: false });
    const code = await emailedLoginCode(app, admin.email);
    const wrong = code === "000000" ? "111111" : "000000";
    await step("POST /console/codes/confirm with a wrong code", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code: wrong,
      });
      expectError(result, 400, "CODE_INVALID");
      expect(result.body.error.CODE_INVALID).toContain("4 tries left");
    });
    await step("POST /console/codes/confirm for an email with no code", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: app.email("nocode"),
        purpose: "login",
        code: wrong,
      });
      expectError(result, 400, "CODE_INVALID");
    });
    await step("POST /console/codes/confirm with a purpose the console does not take", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "password_reset",
        code,
      });
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("Four more wrong tries use the code up", async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await app.api.post("/console/codes/confirm", {
          email: admin.email,
          purpose: "login",
          code: wrong,
        });
        expectError(result, 400, "CODE_INVALID");
      }
    });
    await step("The right code no longer works", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code,
      });
      expectError(result, 400, "CODE_INVALID");
    });
    await step("A new code replaces the dead one", async () => {
      const fresh = await emailedLoginCode(app, admin.email);
      const result = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code: fresh,
      });
      expect(result.status).toBe(200);
    });
  },
);

test(
  "five wrong passwords lock an admin but not a user with the same email",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "After lockoutAttempts wrong passwords the admin account locks. The right password then gets the same 401 as a wrong one, the admin list shows lockedUntil, and each attempt is audited as admin.sign_in_failed. A user with the same email is not affected.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "lock" });
    const user = await app.service.post(
      "/admin/users",
      { email: admin.email, password: OTHER_PASSWORD, emailVerified: true },
      { record: false },
    );
    expect(user.status).toBe(201);
    await step("Five wrong passwords on POST /console/login", () =>
      lockOut(app, admin.email),
    );
    await step("The right password is refused with the same answer", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(result, WRONG_CREDENTIALS.status, WRONG_CREDENTIALS.code);
      expect(result.body.error.AUTHENTICATION_INVALID).toBe(
        "The email or password is wrong.",
      );
    });
    await step("The failed attempts are audited, the last one as locking", async () => {
      const events = (await audit(app, "admin.sign_in_failed")).filter(
        (e) => e.actorLabel === admin.email,
      );
      const passwords = events.filter((e) => e.metadata.reason === "password");
      expect(passwords).toHaveLength(5);
      expect(passwords.filter((e) => e.metadata.locked)).toHaveLength(1);
      expect(events.filter((e) => e.metadata.reason === "locked")).toHaveLength(1);
    });
    await step("GET /admin/admins/{id} shows lockedUntil", async () => {
      const root = await app.root();
      const found = await root.api.get(`/admin/admins/${admin.id}`);
      expect(found.status).toBe(200);
      expect(new Date(found.data.lockedUntil).getTime()).toBeGreaterThan(Date.now());
    });
    await step("The user with the same email still signs in to the app", async () => {
      const login = await app.api.post("/auth/login", {
        email: admin.email,
        password: OTHER_PASSWORD,
      });
      expect(login.status).toBe(200);
    });
    await step("A code sign-in still works while the account is locked", async () => {
      const code = await emailedLoginCode(app, admin.email);
      const result = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code,
      });
      expect(result.status).toBe(200);
    });
  },
);

test(
  "a password reset clears an admin's lockout",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "There is no unlock call. A locked admin resets the password with an emailed code, which ends the lockout and lets the new password sign in at once.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "unlock" });
    await lockOut(app, admin.email);
    const newPassword = "a fresh passphrase";
    await step("POST /console/password/forgot and /reset for the locked admin", async () => {
      const before = await app.mail.count(admin.email);
      const forgot = await app.api.post("/console/password/forgot", {
        email: admin.email,
      });
      expect(forgot.status).toBe(200);
      const code = await app.mail.code(admin.email, { after: before });
      const reset = await app.api.post("/console/password/reset", {
        email: admin.email,
        code,
        newPassword,
      });
      expect(reset.status).toBe(200);
    });
    await step("The new password signs in", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: newPassword,
      });
      expect(result.status).toBe(200);
      expect(result.data.admin.lockedUntil).toBeNull();
    });
  },
);

test(
  "a disabled admin can't sign in and their sessions end",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "Disabling an admin ends their console sessions. The right password then answers ACCOUNT_DISABLED while a wrong one still answers like any wrong password, no code is sent, and a code that was already out is refused.",
    ),
  },
  async () => {
    const admin = await app.admin("gus");
    const root = await app.root();
    const code = await emailedLoginCode(app, admin.email);
    await step("POST /admin/admins/{id}/disable as root", async () => {
      const disabled = await root.api.post(`/admin/admins/${admin.id}/disable`);
      expect(disabled.status).toBe(200);
    });
    await step("Their access token is refused", async () => {
      expectError(await admin.api.get("/console/me"), 401, "TOKEN_INVALID");
    });
    await step("Their refresh token is refused", async () => {
      const refresh = await app.api.post("/console/refresh", {
        refreshToken: admin.tokens.refreshToken,
      });
      expectError(refresh, 401, "TOKEN_INVALID");
    });
    await step("POST /console/login with the right password", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(result, 403, "ACCOUNT_DISABLED");
    });
    await step("POST /console/login with a wrong password", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: "not the right password",
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
    await step("POST /console/codes/confirm with a code sent before the disable", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: admin.email,
        purpose: "login",
        code,
      });
      expectError(result, 403, "ACCOUNT_DISABLED");
    });
    await step("POST /console/codes/send sends nothing", async () => {
      const before = await app.mail.count(admin.email);
      const sent = await app.api.post("/console/codes/send", { email: admin.email });
      expect(sent.status).toBe(200);
      await new Promise((wait) => setTimeout(wait, 500));
      expect(await app.mail.count(admin.email)).toBe(before);
    });
  },
);
