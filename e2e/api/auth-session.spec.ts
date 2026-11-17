import {
  about,
  COOKIE_MODE,
  expect,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims } from "../harness/helpers.ts";
import { query } from "../harness/server.ts";
import { auditEvents, sessionOf, withSettings } from "./auth.support.ts";

const app = useServer();

/** A fresh sign-in on its own client, so every device has its own cookies. */
async function device(email: string, headers: Record<string, string> = {}) {
  const api = await app.newApi("device");
  const login = await api.signIn("/auth/login", email, PASSWORD, { headers, record: false });
  expect(login.status).toBe(200);
  return { api, login, tokens: login.data };
}

test(
  "refreshing rotates the refresh token and spends the old one",
  {
    tag: ["@auth", "@tokens", "@smoke"],
    annotation: about(
      "POST /auth/refresh trades a refresh token for a new access token and a new refresh token. The new pair belongs to the same session, and the old access token keeps working until it expires.",
    ),
  },
  async () => {
    const user = await app.user("rotate", { signIn: false });
    const { api, tokens } = await device(user.email);
    const refreshed = await step("POST /auth/refresh with the refresh token", () =>
      api.post("/auth/refresh", { refreshToken: tokens.refreshToken }, { token: null }),
    );
    await step("It answers 200 TOKENS_REFRESHED with a new pair", async () => {
      expect(refreshed.status).toBe(200);
      expect(refreshed.message).toBe("TOKENS_REFRESHED");
      expect(refreshed.data).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
      expect(refreshed.data.refreshToken).toMatch(/^dgr_/);
      expect(refreshed.data.refreshToken).not.toBe(tokens.refreshToken);
      expect(refreshed.data.accessToken).not.toBe(tokens.accessToken);
      expect(refreshed.data.user.id).toBe(user.id);
    });
    await step("The new token is for the same session and a new token ID", async () => {
      const before = claims(tokens.accessToken);
      const after = claims(refreshed.data.accessToken);
      expect(after.sid).toBe(before.sid);
      expect(after.sub).toBe(before.sub);
      expect(after.jti).not.toBe(before.jti);
    });
    await step("Both access tokens work on GET /auth/me", async () => {
      for (const token of [tokens.accessToken, refreshed.data.accessToken]) {
        expect((await api.get("/auth/me", { token })).status).toBe(200);
      }
    });
    await step("The new refresh token can be used in turn", async () => {
      const again = await api.post("/auth/refresh", { refreshToken: refreshed.data.refreshToken });
      expect(again.status).toBe(200);
      expect(again.data.refreshToken).not.toBe(refreshed.data.refreshToken);
    });
    await step("The session list still shows one session", async () => {
      const sessions = await api.get("/auth/sessions", { token: refreshed.data.accessToken });
      expect(sessions.data).toHaveLength(1);
    });
  },
);

test(
  "a refresh token that is unknown, missing or past its idle limit is TOKEN_INVALID",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "Refreshing needs a token Dopgate issued and has not expired. A missing token, a made-up one and one unused for longer than its idle limit all answer 401 TOKEN_INVALID.",
    ),
  },
  async () => {
    const user = await app.user("stale", { signIn: false });
    const { api, tokens } = await device(user.email);
    await step("No refresh token and no cookie is 401 TOKEN_INVALID", async () => {
      const result = await app.api.post("/auth/refresh", {});
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("A made-up refresh token is 401 TOKEN_INVALID", async () => {
      const result = await app.api.post("/auth/refresh", { refreshToken: "dgr_not-a-real-token" });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("An access token is not a refresh token", async () => {
      const result = await app.api.post("/auth/refresh", { refreshToken: tokens.accessToken });
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("A refresh token past its expiry is 401 TOKEN_INVALID", async () => {
      await query(
        app.server.schema,
        "UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE session_id = $1",
        [sessionOf(tokens.accessToken)],
      );
      const result = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
  },
);

test(
  "a spent refresh token inside the reuse window gets the newest token",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "Two tabs or a retry can send the same refresh token twice. Within tokens.refreshReuseSeconds the second call is answered with the session's newest refresh token, so every tab ends up holding the same one and the session survives.",
    ),
  },
  async () => {
    const user = await app.user("tabs", { signIn: false });
    const { api, tokens } = await device(user.email);
    const first = await step("POST /auth/refresh with the first token", () =>
      api.post("/auth/refresh", { refreshToken: tokens.refreshToken }),
    );
    const repeat = await step("The same first token again, as a second tab would", () =>
      api.post("/auth/refresh", { refreshToken: tokens.refreshToken }),
    );
    await step("It answers 200 with the same new refresh token and a fresh access token", async () => {
      expect(repeat.status).toBe(200);
      expect(repeat.data.refreshToken).toBe(first.data.refreshToken);
      expect(repeat.data.accessToken).not.toBe(first.data.accessToken);
      expect(claims(repeat.data.accessToken).sid).toBe(claims(tokens.accessToken).sid);
    });
    await step("After the session refreshed again, the first token gets the newest one", async () => {
      const second = await api.post("/auth/refresh", { refreshToken: first.data.refreshToken });
      expect(second.status).toBe(200);
      const late = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(late.status).toBe(200);
      expect(late.data.refreshToken).toBe(second.data.refreshToken);
    });
    await step("The session is still alive and nothing was reported as reuse", async () => {
      const me = await api.get("/auth/me", { token: first.data.accessToken });
      expect(me.status).toBe(200);
      const reused = await auditEvents(app, "session.refresh_reused");
      expect(reused.filter((event) => event.metadata.accountId === user.id)).toEqual([]);
    });
  },
);

test(
  "a spent refresh token used after the window ends the session",
  {
    tag: ["@auth", "@tokens", "@security"],
    annotation: about(
      "A spent token that comes back late means someone copied it. Dopgate ends the whole session, answers 401 TOKEN_INVALID, refuses the access token from then on and records session.refresh_reused.",
    ),
  },
  async () => {
    const user = await app.user("copied", { signIn: false });
    const { api, tokens } = await device(user.email);
    const sid = sessionOf(tokens.accessToken);
    const refreshed = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
    await step("The first token was spent a minute ago", async () => {
      await query(
        app.server.schema,
        "UPDATE refresh_tokens SET used_at = used_at - interval '1 minute' WHERE session_id = $1 AND used_at IS NOT NULL",
        [sid],
      );
    });
    await step("Presenting it again is 401 TOKEN_INVALID", async () => {
      const result = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("The newest refresh token and both access tokens are dead", async () => {
      expect((await api.post("/auth/refresh", { refreshToken: refreshed.data.refreshToken })).code).toBe(
        "TOKEN_INVALID",
      );
      for (const token of [tokens.accessToken, refreshed.data.accessToken]) {
        const me = await api.get("/auth/me", { token });
        expect(me.status).toBe(401);
        expect(me.code).toBe("TOKEN_INVALID");
      }
    });
    await step("The audit log has session.refresh_reused for that session", async () => {
      const events = await auditEvents(app, "session.refresh_reused");
      const mine = events.find((event) => event.resourceId === sid);
      expect(mine).toMatchObject({
        actorType: "anonymous",
        actorLabel: "refresh",
        resourceType: "session",
        metadata: { accountId: user.id },
      });
    });
  },
);

test(
  "with the reuse window off, any repeat of a refresh token ends the session",
  {
    tag: ["@auth", "@tokens", "@settings"],
    annotation: about(
      "Setting tokens.refreshReuseSeconds to 0 removes the grace period. The very next use of a spent refresh token is treated as theft.",
    ),
  },
  async () => {
    const user = await app.user("strict", { signIn: false });
    await withSettings(app, "tokens", { refreshReuseSeconds: 0 }, async () => {
      const { api, tokens } = await device(user.email);
      const refreshed = await step("POST /auth/refresh once", () =>
        api.post("/auth/refresh", { refreshToken: tokens.refreshToken }),
      );
      expect(refreshed.status).toBe(200);
      await step("The spent token is TOKEN_INVALID at once", async () => {
        const result = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
        expect(result.status).toBe(401);
        expect(result.code).toBe("TOKEN_INVALID");
      });
      await step("The session is gone, so the newest token is dead too", async () => {
        const result = await api.post("/auth/refresh", { refreshToken: refreshed.data.refreshToken });
        expect(result.code).toBe("TOKEN_INVALID");
        expect((await api.get("/auth/me", { token: refreshed.data.accessToken })).status).toBe(401);
      });
    });
  },
);

test(
  "a refresh token can ride in the cookie and the cookie rotates with it",
  {
    tag: ["@auth", "@tokens", "@security"],
    annotation: about(
      "A browser client on Dopgate's own origin refreshes with only its cookie. With the cookie header the new refresh token goes back into the cookie and out of the body. Without the header the body carries it.",
    ),
  },
  async () => {
    const user = await app.user("browser", { signIn: false });
    const { api, login } = await device(user.email, COOKIE_MODE);
    const first = await api.cookie("dopgate_refresh");
    await step("Sign-in left a dopgate_refresh cookie and no token in the body", async () => {
      expect(first).toMatch(/^dgr_/);
      expect(login.data.refreshToken).toBeNull();
    });
    const refreshed = await step("POST /auth/refresh with an empty body and the cookie header", () =>
      api.post("/auth/refresh", {}, { headers: COOKIE_MODE, token: null }),
    );
    await step("The body has no refresh token and the cookie holds a new one", async () => {
      expect(refreshed.status).toBe(200);
      expect(refreshed.data.refreshToken).toBeNull();
      expect(refreshed.data.accessToken).toEqual(expect.any(String));
      expect(refreshed.setCookies[0]).toMatch(/^dopgate_refresh=dgr_.*HttpOnly/);
      const second = await api.cookie("dopgate_refresh");
      expect(second).toMatch(/^dgr_/);
      expect(second).not.toBe(first);
    });
    await step("Without the header the cookie still works and the body has the token", async () => {
      const plain = await api.post("/auth/refresh", {}, { token: null });
      expect(plain.status).toBe(200);
      expect(plain.data.refreshToken).toMatch(/^dgr_/);
    });
    await step("A body token wins over the cookie", async () => {
      const result = await api.post("/auth/refresh", { refreshToken: "dgr_wrong" }, { token: null });
      expect(result.code).toBe("TOKEN_INVALID");
    });
  },
);

test(
  "a disabled account cannot refresh, and its access tokens are refused",
  {
    tag: ["@auth", "@tokens", "@users"],
    annotation: about(
      "Disabling an account ends its sessions, so the old refresh and access tokens answer TOKEN_INVALID. If an account is flagged disabled while a session is still open, the same calls answer ACCOUNT_DISABLED instead. Enabling the account does not bring ended sessions back.",
    ),
  },
  async () => {
    const user = await app.user("benched", { signIn: false });
    const { api, tokens } = await device(user.email);
    await step("An admin disables the account", async () => {
      const disabled = await app.service.post(`/admin/users/${user.id}/disable`, undefined, {
        record: false,
      });
      expect(disabled.status).toBe(200);
    });
    await step("POST /auth/refresh answers TOKEN_INVALID because the session ended", async () => {
      const result = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("GET /auth/me with the old access token answers TOKEN_INVALID", async () => {
      const result = await api.get("/auth/me", { token: tokens.accessToken });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("After enabling, the old refresh token is still dead", async () => {
      await app.service.post(`/admin/users/${user.id}/enable`, undefined, { record: false });
      const result = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("A disabled flag on an open session answers ACCOUNT_DISABLED", async () => {
      const live = await device(user.email);
      await query(app.server.schema, "UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);
      const refresh = await live.api.post("/auth/refresh", { refreshToken: live.tokens.refreshToken });
      expect(refresh.status).toBe(403);
      expect(refresh.code).toBe("ACCOUNT_DISABLED");
      const me = await live.api.get("/auth/me");
      expect(me.status).toBe(403);
      expect(me.code).toBe("ACCOUNT_DISABLED");
      await query(app.server.schema, "UPDATE users SET status = 'active' WHERE id = $1", [user.id]);
    });
  },
);

test(
  "logging out with the access token ends that session only",
  {
    tag: ["@auth", "@tokens", "@smoke"],
    annotation: about(
      "POST /auth/logout with a valid access token ends the session the token belongs to. The refresh token and the access token both stop working, and the user's other devices stay signed in.",
    ),
  },
  async () => {
    const user = await app.user("leaving", { signIn: false });
    const laptop = await device(user.email);
    const phone = await device(user.email);
    const out = await step("POST /auth/logout from the laptop", () => laptop.api.post("/auth/logout", {}));
    await step("It answers 200 SIGNED_OUT with no data", async () => {
      expect(out.status).toBe(200);
      expect(out.message).toBe("SIGNED_OUT");
      expect(out.data).toBeNull();
    });
    await step("The laptop's access token and refresh token are dead", async () => {
      const me = await laptop.api.get("/auth/me");
      expect(me.status).toBe(401);
      expect(me.code).toBe("TOKEN_INVALID");
      const refresh = await laptop.api.post("/auth/refresh", { refreshToken: laptop.tokens.refreshToken });
      expect(refresh.code).toBe("TOKEN_INVALID");
    });
    await step("The phone is still signed in", async () => {
      expect((await phone.api.get("/auth/me")).status).toBe(200);
    });
    await step("The audit log has user.signed_out with the session", async () => {
      const events = await auditEvents(app, "user.signed_out", user.email);
      expect(events[0]).toMatchObject({
        actorId: user.id,
        metadata: { allSessions: false, sessionId: sessionOf(laptop.tokens.accessToken) },
      });
    });
  },
);

test(
  "logging out with only a refresh token works after the access token expired",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "An app that lost its access token can still sign out by sending the refresh token. An unknown refresh token still answers 200, and a call with neither token is 401 AUTHENTICATION_REQUIRED.",
    ),
  },
  async () => {
    const user = await app.user("expired", { signIn: false });
    const { api, tokens } = await device(user.email);
    await step("POST /auth/logout with neither token is AUTHENTICATION_REQUIRED", async () => {
      const result = await app.api.post("/auth/logout", {});
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("An unknown refresh token still answers 200", async () => {
      const result = await app.api.post("/auth/logout", { refreshToken: "dgr_never-issued" });
      expect(result.status).toBe(200);
      expect(result.message).toBe("SIGNED_OUT");
    });
    await step("The refresh token alone ends its session", async () => {
      const result = await app.api.post("/auth/logout", { refreshToken: tokens.refreshToken });
      expect(result.status).toBe(200);
      expect((await api.get("/auth/me")).status).toBe(401);
      expect((await api.post("/auth/refresh", { refreshToken: tokens.refreshToken })).code).toBe(
        "TOKEN_INVALID",
      );
    });
    await step("A garbage access token with no refresh token is 401", async () => {
      const result = await app.api.post("/auth/logout", {}, { token: "not.a.token" });
      expect(result.status).toBe(401);
    });
  },
);

test(
  "logging out of all sessions signs out every device and clears the cookie",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "With allSessions true, one logout ends every session of the account. In cookie mode the response clears the dopgate_refresh cookie.",
    ),
  },
  async () => {
    const user = await app.user("everywhere", { signIn: false });
    const laptop = await device(user.email);
    const phone = await device(user.email);
    const browser = await device(user.email, COOKIE_MODE);
    await step("POST /auth/logout with allSessions from the laptop", async () => {
      const result = await laptop.api.post("/auth/logout", { allSessions: true });
      expect(result.status).toBe(200);
    });
    await step("Every device is signed out", async () => {
      for (const each of [laptop, phone, browser]) {
        expect((await each.api.get("/auth/me")).status).toBe(401);
      }
      expect((await phone.api.post("/auth/refresh", { refreshToken: phone.tokens.refreshToken })).code).toBe(
        "TOKEN_INVALID",
      );
    });
    await step("The audit log says allSessions", async () => {
      const events = await auditEvents(app, "user.signed_out", user.email);
      expect(events[0]!.metadata.allSessions).toBe(true);
    });
    await step("A cookie logout clears the cookie", async () => {
      const again = await device(user.email, COOKIE_MODE);
      const result = await again.api.post("/auth/logout", {}, { headers: COOKIE_MODE, token: null });
      expect(result.status).toBe(200);
      expect(result.setCookies).toEqual([
        "dopgate_refresh=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0",
      ]);
      expect(await again.api.cookie("dopgate_refresh")).toBeUndefined();
      expect((await again.api.get("/auth/me", { token: again.tokens.accessToken })).status).toBe(401);
    });
  },
);

test(
  "the session list shows each device, the current one and how it signed in",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "GET /auth/sessions lists the user's open sessions, most recently used first. Each has the sign-in method, the address and user agent seen at sign-in, a current flag and its times. It lists no one else's sessions.",
    ),
  },
  async () => {
    const user = await app.user("devices", { signIn: false });
    const stranger = await app.user("stranger");
    const laptop = await device(user.email, { "User-Agent": "DopgateE2E laptop/1.0" });
    const phone = await device(user.email, { "User-Agent": "DopgateE2E phone/2.0" });
    await step("Sign in once more with a login code", async () => {
      const before = await app.mail.count(user.email);
      await app.api.post("/auth/verification/send", { email: user.email, purpose: "login" });
      await app.mail.last(user.email, { after: before });
    });
    const otp = await app.api.post("/auth/verification/confirm", {
      email: user.email,
      purpose: "login",
      code: await app.mail.code(user.email),
    });
    const sessions = await step("GET /auth/sessions from the laptop", () => laptop.api.get("/auth/sessions"));
    await step("It answers 200 SESSIONS_FETCHED with three sessions", async () => {
      expect(sessions.status).toBe(200);
      expect(sessions.message).toBe("SESSIONS_FETCHED");
      expect(sessions.data).toHaveLength(3);
    });
    await step("Exactly one is current, and it is the laptop's", async () => {
      const current = sessions.data.filter((session: any) => session.current);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(sessionOf(laptop.tokens.accessToken));
      expect(current[0]).toMatchObject({ method: "password", userAgent: "DopgateE2E laptop/1.0" });
    });
    await step("Each session has an address, a user agent, a method and times", async () => {
      for (const session of sessions.data) {
        expect(session.id).toMatch(/^ses_/);
        expect(session.ipAddress).toBe("127.0.0.1");
        expect(["password", "otp"]).toContain(session.method);
        expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.parse(session.createdAt));
        expect(Date.parse(session.lastUsedAt)).toBeGreaterThanOrEqual(Date.parse(session.createdAt));
      }
      const byId = new Map(sessions.data.map((session: any) => [session.id, session]));
      expect((byId.get(sessionOf(phone.tokens.accessToken)) as any).userAgent).toBe(
        "DopgateE2E phone/2.0",
      );
      expect((byId.get(sessionOf(otp.data.accessToken)) as any).method).toBe("otp");
    });
    await step("The newest session comes first", async () => {
      const used = sessions.data.map((session: any) => Date.parse(session.lastUsedAt));
      expect(used).toEqual([...used].sort((a, b) => b - a));
    });
    await step("Another user's list has only their own session", async () => {
      const theirs = await stranger.api.get("/auth/sessions");
      expect(theirs.data).toHaveLength(1);
      expect(theirs.data[0].id).toBe(sessionOf(stranger.tokens!.accessToken));
    });
    await step("Without a token the list is 401 AUTHENTICATION_REQUIRED", async () => {
      const result = await app.api.get("/auth/sessions");
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("The service key is refused with AUTHORIZATION_DENIED", async () => {
      const result = await app.service.get("/auth/sessions");
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
  },
);

test(
  "revoking a session ends it at once and only that one",
  {
    tag: ["@auth", "@tokens", "@security"],
    annotation: about(
      "DELETE /auth/sessions/{id} ends one of the user's other sessions. That device's access token is refused on Dopgate right away, even though it has not expired, and its refresh token stops working.",
    ),
  },
  async () => {
    const user = await app.user("revoker", { signIn: false });
    const laptop = await device(user.email);
    const phone = await device(user.email);
    const phoneSession = sessionOf(phone.tokens.accessToken);
    const revoked = await step("DELETE /auth/sessions/{id} for the phone, from the laptop", () =>
      laptop.api.delete(`/auth/sessions/${phoneSession}`),
    );
    await step("It answers 200 SESSION_REVOKED", async () => {
      expect(revoked.status).toBe(200);
      expect(revoked.message).toBe("SESSION_REVOKED");
    });
    await step("The phone's access token is refused before it expires", async () => {
      const me = await phone.api.get("/auth/me");
      expect(me.status).toBe(401);
      expect(me.code).toBe("TOKEN_INVALID");
    });
    await step("The phone's refresh token is dead", async () => {
      const result = await phone.api.post("/auth/refresh", { refreshToken: phone.tokens.refreshToken });
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("The list shows only the laptop", async () => {
      const sessions = await laptop.api.get("/auth/sessions");
      expect(sessions.data.map((session: any) => session.id)).toEqual([
        sessionOf(laptop.tokens.accessToken),
      ]);
    });
    await step("Revoking it again is 404 NOT_FOUND", async () => {
      const again = await laptop.api.delete(`/auth/sessions/${phoneSession}`);
      expect(again.status).toBe(404);
      expect(again.code).toBe("NOT_FOUND");
    });
    await step("The audit log has session.revoked", async () => {
      const events = await auditEvents(app, "session.revoked", user.email);
      expect(events[0]).toMatchObject({ resourceType: "session", resourceId: phoneSession });
    });
    await step("A user can end their own current session by its ID", async () => {
      const own = sessionOf(laptop.tokens.accessToken);
      expect((await laptop.api.delete(`/auth/sessions/${own}`)).status).toBe(200);
      expect((await laptop.api.get("/auth/me")).status).toBe(401);
    });
  },
);

test(
  "nobody can end a session that belongs to someone else",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A user who guesses or learns another user's session ID gets 404 NOT_FOUND, the same as for an ID that does not exist, and the other session stays open. An admin's console session cannot be ended from here either.",
    ),
  },
  async () => {
    const ana = await app.user("ana");
    const bo = await app.user("bo");
    const boSession = sessionOf(bo.tokens!.accessToken);
    await step("DELETE /auth/sessions/{id} of Bo's session as Ana is 404 NOT_FOUND", async () => {
      const result = await ana.api.delete(`/auth/sessions/${boSession}`);
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
    });
    await step("An ID that does not exist gets the same answer", async () => {
      const result = await ana.api.delete("/auth/sessions/ses_00000000000000000000000000");
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
    });
    await step("An admin's console session is not found either", async () => {
      const root = await app.root();
      const console = await root.api.get("/console/sessions", { record: false });
      const id = console.data[0].id as string;
      const result = await ana.api.delete(`/auth/sessions/${id}`);
      expect(result.status).toBe(404);
    });
    await step("Bo is still signed in", async () => {
      expect((await bo.api.get("/auth/me")).status).toBe(200);
    });
    await step("Without a token the route is 401", async () => {
      const result = await app.api.delete(`/auth/sessions/${boSession}`);
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
  },
);

test(
  "ending all sessions can keep the current one",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "DELETE /auth/sessions ends every session of the user. With keepCurrent=true the session making the request stays. Both are recorded as session.revoked_all with a count.",
    ),
  },
  async () => {
    const user = await app.user("sweeper", { signIn: false });
    const laptop = await device(user.email);
    const phone = await device(user.email);
    const tablet = await device(user.email);
    const other = await app.user("bystander");
    await step("DELETE /auth/sessions?keepCurrent=true from the laptop", async () => {
      const result = await laptop.api.delete("/auth/sessions?keepCurrent=true");
      expect(result.status).toBe(200);
      expect(result.message).toBe("SESSIONS_REVOKED");
    });
    await step("The phone and the tablet are signed out, the laptop is not", async () => {
      expect((await phone.api.get("/auth/me")).status).toBe(401);
      expect((await tablet.api.get("/auth/me")).status).toBe(401);
      expect((await laptop.api.get("/auth/me")).status).toBe(200);
      expect((await laptop.api.get("/auth/sessions")).data).toHaveLength(1);
    });
    await step("The audit log counts two sessions and says the current one was kept", async () => {
      const events = await auditEvents(app, "session.revoked_all", user.email);
      expect(events[0]!.metadata).toMatchObject({ sessions: 2, keptCurrent: true });
    });
    const again = await device(user.email);
    await step("DELETE /auth/sessions without keepCurrent signs out everything", async () => {
      const result = await again.api.delete("/auth/sessions");
      expect(result.status).toBe(200);
      expect((await again.api.get("/auth/me")).status).toBe(401);
      expect((await laptop.api.get("/auth/me")).status).toBe(401);
      const events = await auditEvents(app, "session.revoked_all", user.email);
      expect(events[0]!.metadata).toMatchObject({ sessions: 2, keptCurrent: false });
    });
    await step("Another user's sessions are untouched", async () => {
      expect((await other.api.get("/auth/me")).status).toBe(200);
    });
    await step("Without a token the route is 401", async () => {
      expect((await app.api.delete("/auth/sessions")).code).toBe("AUTHENTICATION_REQUIRED");
    });
  },
);

test(
  "a session past its absolute end stops working",
  {
    tag: ["@auth", "@tokens"],
    annotation: about(
      "A session ends at the latest sessionAbsoluteDays after sign-in, however often it refreshes. Once that time passes the access token and the refresh token are refused and the session drops out of the list.",
    ),
  },
  async () => {
    const user = await app.user("old", { signIn: false });
    const { api, tokens } = await device(user.email);
    const fresh = await device(user.email);
    await step("The session's absolute end passes", async () => {
      await query(
        app.server.schema,
        "UPDATE sessions SET absolute_expires_at = now() - interval '1 second' WHERE id = $1",
        [sessionOf(tokens.accessToken)],
      );
    });
    await step("The access token is refused", async () => {
      const me = await api.get("/auth/me");
      expect(me.status).toBe(401);
      expect(me.code).toBe("TOKEN_INVALID");
    });
    await step("The refresh token is refused", async () => {
      const result = await api.post("/auth/refresh", { refreshToken: tokens.refreshToken });
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("The list holds only the live session", async () => {
      const sessions = await fresh.api.get("/auth/sessions");
      expect(sessions.data.map((session: any) => session.id)).toEqual([
        sessionOf(fresh.tokens.accessToken),
      ]);
    });
  },
);
