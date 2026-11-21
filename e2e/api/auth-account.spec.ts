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
import { ageCode, auditEvents, NEW_PASSWORD, withSettings } from "./auth.support.ts";

const app = useServer();

/** Asks for a code at `email` and waits for the new message. */
async function codeAfter(email: string, ask: () => Promise<unknown>): Promise<string> {
  const before = await app.mail.count(email);
  await ask();
  await app.mail.last(email, { after: before });
  return app.mail.code(email);
}

test(
  "GET /auth/me returns the signed-in user and nothing private",
  {
    tag: ["@auth", "@smoke"],
    annotation: about(
      "The signed-in user reads their own account. It has profile fields, userMetadata and publicMetadata, and never privateMetadata. Without a user's token the route refuses.",
    ),
  },
  async () => {
    const user = await app.user("ana", {
      displayName: "Ana Silva",
      publicMetadata: { plan: "pro" },
      privateMetadata: { note: "vip" },
    });
    const me = await step("GET /auth/me with the access token", () => user.api.get("/auth/me"));
    await step("It answers 200 ACCOUNT_FETCHED with the user object", async () => {
      expect(me.status).toBe(200);
      expect(me.message).toBe("ACCOUNT_FETCHED");
      expect(me.data).toMatchObject({
        id: user.id,
        email: user.email,
        emailVerified: true,
        displayName: "Ana Silva",
        avatarUrl: null,
        status: "active",
        userMetadata: {},
        publicMetadata: { plan: "pro" },
        hasPassword: true,
      });
      expect(me.data.lastSignInAt).toEqual(expect.any(String));
      expect(me.data.createdAt).toEqual(expect.any(String));
    });
    await step("There is no privateMetadata in the answer", async () => {
      expect(me.data).not.toHaveProperty("privateMetadata");
      expect(JSON.stringify(me.body)).not.toContain("vip");
    });
    await step("No token is 401 AUTHENTICATION_REQUIRED", async () => {
      const result = await app.api.get("/auth/me");
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("A token that is not a JWT is 401 AUTHENTICATION_INVALID", async () => {
      const result = await app.api.get("/auth/me", { token: "not-a-token" });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("A JWT with a broken signature is 401 TOKEN_INVALID", async () => {
      const [head, body] = user.tokens!.accessToken.split(".");
      const result = await app.api.get("/auth/me", { token: `${head}.${body}.AAAA` });
      expect(result.status).toBe(401);
      expect(result.code).toBe("TOKEN_INVALID");
    });
    await step("The service key is 403 AUTHORIZATION_DENIED", async () => {
      const result = await app.service.get("/auth/me");
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("An admin's console token is 403 AUTHORIZATION_DENIED", async () => {
      const root = await app.root();
      const result = await app.api.get("/auth/me", { token: root.tokens.accessToken });
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
  },
);

test(
  "PATCH /auth/me changes only the fields that are sent",
  {
    tag: ["@auth", "@users"],
    annotation: about(
      "A user updates their display name, avatar and userMetadata. Fields left out stay as they are, strings are trimmed, an empty string clears a profile field, and userMetadata is replaced as a whole. The change is audited.",
    ),
  },
  async () => {
    const user = await app.user("profile", { displayName: "Before" });
    const patch = (body: Record<string, unknown>) => user.api.patch("/auth/me", body);
    const updated = await step("PATCH /auth/me with a name, an avatar and metadata", () =>
      patch({
        displayName: "  Ana L ",
        avatarUrl: "https://cdn.example.com/ana.png",
        userMetadata: { theme: "dark", lang: "pt" },
      }),
    );
    await step("It answers 200 PROFILE_UPDATED with the new profile", async () => {
      expect(updated.status).toBe(200);
      expect(updated.message).toBe("PROFILE_UPDATED");
      expect(updated.data).toMatchObject({
        id: user.id,
        displayName: "Ana L",
        avatarUrl: "https://cdn.example.com/ana.png",
        userMetadata: { theme: "dark", lang: "pt" },
      });
    });
    await step("GET /auth/me shows the same", async () => {
      const me = await user.api.get("/auth/me");
      expect(me.data).toMatchObject({ displayName: "Ana L", userMetadata: { theme: "dark", lang: "pt" } });
    });
    await step("A patch with only userMetadata leaves the name and avatar", async () => {
      const result = await patch({ userMetadata: { theme: "light" } });
      expect(result.data).toMatchObject({
        displayName: "Ana L",
        avatarUrl: "https://cdn.example.com/ana.png",
        userMetadata: { theme: "light" },
      });
    });
    await step("An empty body changes nothing", async () => {
      const result = await patch({});
      expect(result.status).toBe(200);
      expect(result.data).toMatchObject({ displayName: "Ana L", userMetadata: { theme: "light" } });
    });
    await step("An empty string clears the display name and the avatar", async () => {
      const result = await patch({ displayName: "", avatarUrl: "" });
      expect(result.data.displayName).toBeNull();
      expect(result.data.avatarUrl).toBeNull();
      expect(result.data.userMetadata).toEqual({ theme: "light" });
    });
    await step("An empty object clears userMetadata", async () => {
      const result = await patch({ userMetadata: {} });
      expect(result.data.userMetadata).toEqual({});
    });
    await step("A 255-character name and a 2048-character avatar URL are accepted", async () => {
      const url = `https://cdn.example.com/${"a".repeat(2048 - "https://cdn.example.com/".length)}`;
      const result = await patch({ displayName: "n".repeat(255), avatarUrl: url });
      expect(result.status).toBe(200);
      expect(result.data.avatarUrl).toBe(url);
    });
    await step("The audit log has user.profile_updated for this user", async () => {
      const events = await auditEvents(app, "user.profile_updated", user.email);
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0]).toMatchObject({ actorId: user.id, resourceId: user.id });
    });
    await step("Without a token the route is 401", async () => {
      const result = await app.api.patch("/auth/me", { displayName: "x" });
      expect(result.status).toBe(401);
    });
  },
);

test(
  "a user cannot write publicMetadata or other fields they do not own",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "publicMetadata is set by the app's backend and ends up in the token. A user who adds it to PATCH /auth/me, along with an email, a status or privateMetadata, changes none of them.",
    ),
  },
  async () => {
    const user = await app.user("sneaky", { publicMetadata: { role: "customer" } });
    const result = await step("PATCH /auth/me with publicMetadata, email, status and privateMetadata", () =>
      user.api.patch("/auth/me", {
        displayName: "Sneaky",
        publicMetadata: { role: "admin" },
        privateMetadata: { note: "hello" },
        email: app.email("other"),
        status: "disabled",
        emailVerified: false,
      }),
    );
    await step("Only the display name changed", async () => {
      expect(result.status).toBe(200);
      expect(result.data).toMatchObject({
        email: user.email,
        displayName: "Sneaky",
        status: "active",
        emailVerified: true,
        publicMetadata: { role: "customer" },
      });
    });
    await step("The admin API agrees", async () => {
      const stored = await app.service.get(`/admin/users/${user.id}`, { record: false });
      expect(stored.data).toMatchObject({
        publicMetadata: { role: "customer" },
        privateMetadata: {},
        email: user.email,
      });
    });
    await step("A fresh token still carries the old public_metadata", async () => {
      const refreshed = await user.api.post("/auth/refresh", { refreshToken: user.tokens!.refreshToken });
      expect(claims(refreshed.data.accessToken).public_metadata).toEqual({ role: "customer" });
    });
  },
);

test(
  "PATCH /auth/me refuses bad profile fields and bad metadata",
  {
    tag: ["@auth"],
    annotation: about(
      "A name that is too long or has a line break, and an avatar that is not an http(s) URL or is over 2048 characters, answer 422 PROFILE_INVALID. Metadata that is not an object, or over 16 KB, answers 422 METADATA_INVALID. A failed patch changes nothing.",
    ),
  },
  async () => {
    const user = await app.user("strict", { displayName: "Keep me" });
    const patch = (body: Record<string, unknown>) => user.api.patch("/auth/me", body);
    const profile: [string, Record<string, unknown>][] = [
      ["a 256-character name", { displayName: "n".repeat(256) }],
      ["a name with a line break", { displayName: "Ana\nSilva" }],
      ["a javascript: avatar", { avatarUrl: "javascript:alert(1)" }],
      ["an ftp avatar", { avatarUrl: "ftp://files.example.com/a.png" }],
      ["an avatar over 2048 characters", { avatarUrl: `https://cdn.example.com/${"a".repeat(2048)}` }],
    ];
    for (const [label, body] of profile) {
      await step(`PATCH /auth/me with ${label} is PROFILE_INVALID`, async () => {
        const result = await patch(body);
        expect(result.status).toBe(422);
        expect(result.code).toBe("PROFILE_INVALID");
      });
    }
    const metadata: [string, unknown][] = [
      ["an array", [1, 2]],
      ["a string", "dark"],
      ["a number", 7],
      ["an object over 16 KB", { blob: "x".repeat(16 * 1024) }],
    ];
    for (const [label, value] of metadata) {
      await step(`userMetadata as ${label} is METADATA_INVALID`, async () => {
        const result = await patch({ userMetadata: value });
        expect(result.status).toBe(422);
        expect(result.code).toBe("METADATA_INVALID");
      });
    }
    await step("An object just under 16 KB is accepted", async () => {
      const result = await patch({ userMetadata: { blob: "x".repeat(16 * 1024 - 100) } });
      expect(result.status).toBe(200);
      await patch({ userMetadata: {} });
    });
    await step("A bad field next to a good one rejects the whole patch", async () => {
      const result = await patch({ displayName: "Changed", avatarUrl: "gopher://x" });
      expect(result.status).toBe(422);
      const me = await user.api.get("/auth/me");
      expect(me.data.displayName).toBe("Keep me");
    });
  },
);

test(
  "changing the password ends the other sessions and emails a notice",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "With the right current password, POST /auth/password/change sets the new one. The session that asked stays signed in, every other session ends, the old password stops working and a password_changed notice goes to the account's email.",
    ),
  },
  async () => {
    const user = await app.user("changer", { signIn: false });
    const laptop = await app.userSession(user.email, PASSWORD, "laptop");
    const phone = await app.userSession(user.email, PASSWORD, "phone");
    const before = await app.mail.count(user.email);
    const changed = await step("POST /auth/password/change from the laptop", () =>
      laptop.api.post("/auth/password/change", {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    );
    await step("It answers 200 PASSWORD_CHANGED with no data", async () => {
      expect(changed.status).toBe(200);
      expect(changed.message).toBe("PASSWORD_CHANGED");
      expect(changed.data).toBeNull();
    });
    await step("The laptop stays signed in and the phone is signed out", async () => {
      expect((await laptop.api.get("/auth/me")).status).toBe(200);
      const gone = await phone.api.get("/auth/me");
      expect(gone.status).toBe(401);
      expect(gone.code).toBe("TOKEN_INVALID");
      const refresh = await phone.api.post("/auth/refresh", { refreshToken: phone.tokens.refreshToken });
      expect(refresh.code).toBe("TOKEN_INVALID");
    });
    await step("A password_changed notice went to the account email", async () => {
      const mail = await app.mail.last(user.email, { after: before });
      expect(mail.subject).toBe("Your Dopgate password was changed");
      expect(mail.text).toContain("other devices were signed out");
      expect(mail.text).not.toContain(NEW_PASSWORD);
    });
    await step("Only the new password signs in", async () => {
      const old = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
      expect(old.code).toBe("AUTHENTICATION_INVALID");
      const fresh = await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD });
      expect(fresh.status).toBe(200);
    });
    await step("The audit log counts the other sessions that ended", async () => {
      const events = await auditEvents(app, "user.password_changed", user.email);
      expect(events).toHaveLength(1);
      expect(events[0]!.metadata).toMatchObject({ otherSessionsEnded: 1 });
    });
    await step("Without a token the route is 401", async () => {
      const result = await app.api.post("/auth/password/change", {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(result.status).toBe(401);
    });
  },
);

test(
  "a password change refuses a wrong current password and a bad new one",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A wrong or missing current password is 401 AUTHENTICATION_INVALID and is audited as password_check_failed. A new password that is short, too long or on the leaked list is refused with 422, and nothing changes.",
    ),
  },
  async () => {
    const user = await app.user("picky");
    const change = (body: Record<string, unknown>) => user.api.post("/auth/password/change", body);
    await step("A wrong current password is 401 AUTHENTICATION_INVALID", async () => {
      const result = await change({ currentPassword: "not mine", newPassword: NEW_PASSWORD });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("No current password is 401 AUTHENTICATION_INVALID", async () => {
      const result = await change({ newPassword: NEW_PASSWORD });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("A new password of seven characters is PASSWORD_INVALID", async () => {
      const result = await change({ currentPassword: PASSWORD, newPassword: "seven77" });
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("A new password over 1024 bytes is PASSWORD_INVALID", async () => {
      const result = await change({ currentPassword: PASSWORD, newPassword: "x".repeat(1025) });
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("A leaked new password is PASSWORD_LEAKED", async () => {
      const result = await change({ currentPassword: PASSWORD, newPassword: LEAKED_PASSWORD });
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_LEAKED");
    });
    await step("The audit log shows the two wrong checks", async () => {
      const events = await auditEvents(app, "user.password_check_failed", user.email);
      expect(events).toHaveLength(2);
      expect(events[0]!.metadata).toMatchObject({ reason: "password", locked: false });
    });
    await step("The old password still signs in and no session ended", async () => {
      expect((await app.api.post("/auth/login", { email: user.email, password: PASSWORD })).status).toBe(200);
      expect((await user.api.get("/auth/me")).status).toBe(200);
    });
  },
);

test(
  "wrong current passwords lock the account like wrong sign-ins do",
  {
    tag: ["@auth", "@security", "@limits"],
    annotation: about(
      "A stolen access token must not be able to guess the password forever. Wrong current passwords on a password or email change count toward the lockout. Once locked, the right current password is refused too, and so is sign-in.",
    ),
  },
  async () => {
    const user = await app.user("guarded");
    await withSettings(app, "limits", { lockoutAttempts: 3 }, async () => {
      await step("Two wrong passwords on /auth/password/change", async () => {
        for (let i = 0; i < 2; i++) {
          const result = await user.api.post("/auth/password/change", {
            currentPassword: "wrong",
            newPassword: NEW_PASSWORD,
          });
          expect(result.code).toBe("AUTHENTICATION_INVALID");
        }
      });
      await step("The third, on /auth/email/change, locks the account", async () => {
        const result = await user.api.post("/auth/email/change", {
          newEmail: app.email("never"),
          password: "wrong",
        });
        expect(result.status).toBe(401);
        const stored = await app.service.get(`/admin/users/${user.id}`, { record: false });
        expect(stored.data.lockedUntil).toEqual(expect.any(String));
      });
      await step("The right current password is refused while locked", async () => {
        const result = await user.api.post("/auth/password/change", {
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        });
        expect(result.status).toBe(401);
        expect(result.code).toBe("AUTHENTICATION_INVALID");
        const email = await user.api.post("/auth/email/change", {
          newEmail: app.email("never"),
          password: PASSWORD,
        });
        expect(email.code).toBe("AUTHENTICATION_INVALID");
      });
      await step("Sign-in with the right password is refused too", async () => {
        const result = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
        expect(result.status).toBe(401);
      });
      await step("The audit log marks the attempt that locked it", async () => {
        const events = await auditEvents(app, "user.password_check_failed", user.email);
        expect(events.filter((event) => event.metadata.locked === true)).toHaveLength(1);
        expect(events.filter((event) => event.metadata.reason === "locked").length).toBeGreaterThan(0);
      });
    });
  },
);

test(
  "an account with no password sets its first one with a reset code",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A user made without a password has no current password to give. POST /auth/password/change then needs a password_reset code from /auth/password/forgot, so a stolen access token cannot add a password the thief keeps. The session stays signed in.",
    ),
  },
  async () => {
    const user = await app.user("codeonly", { password: false });
    const api = await app.newApi("codeonly");
    await step("Sign in with a login code", async () => {
      const code = await codeAfter(user.email, () =>
        api.post("/auth/verification/send", { email: user.email, purpose: "login" }, { record: false }),
      );
      const result = await api.post(
        "/auth/verification/confirm",
        { email: user.email, purpose: "login", code },
        { record: false },
      );
      expect(result.data.user.hasPassword).toBe(false);
      api.token = result.data.accessToken;
    });
    await step("A new password without a code is 400 CODE_INVALID", async () => {
      const result = await api.post("/auth/password/change", { newPassword: NEW_PASSWORD });
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
      expect(result.body.error.CODE_INVALID).toContain("no password yet");
    });
    await step("A wrong code is 400 CODE_INVALID", async () => {
      const result = await api.post("/auth/password/change", { newPassword: NEW_PASSWORD, code: "000000" });
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
    });
    const code = await step("POST /auth/password/forgot to get a reset code", () =>
      codeAfter(user.email, () => app.api.post("/auth/password/forgot", { email: user.email })),
    );
    await step("The code with a short password is PASSWORD_INVALID", async () => {
      const result = await api.post("/auth/password/change", { newPassword: "short", code });
      expect(result.status).toBe(422);
      expect(result.code).toBe("PASSWORD_INVALID");
    });
    await step("The right code sets the password and keeps the session", async () => {
      const result = await api.post("/auth/password/change", { newPassword: NEW_PASSWORD, code });
      expect(result.status).toBe(200);
      expect(result.message).toBe("PASSWORD_CHANGED");
      const me = await api.get("/auth/me");
      expect(me.status).toBe(200);
      expect(me.data.hasPassword).toBe(true);
    });
    await step("The password signs in, and a code no longer replaces the current password", async () => {
      const login = await app.api.post("/auth/login", { email: user.email, password: NEW_PASSWORD });
      expect(login.status).toBe(200);
      const again = await api.post("/auth/password/change", { newPassword: "yet another passphrase", code });
      expect(again.status).toBe(401);
      expect(again.code).toBe("AUTHENTICATION_INVALID");
    });
  },
);

test(
  "an expired code cannot set a password for an account without one",
  {
    tag: ["@auth"],
    annotation: about(
      "The code from /auth/password/forgot has the usual lifetime. Past it, the password change answers 400 CODE_EXPIRED.",
    ),
  },
  async () => {
    const user = await app.user("late", { password: false });
    const api = await app.newApi("late");
    const code = await codeAfter(user.email, () =>
      api.post("/auth/verification/send", { email: user.email, purpose: "login" }, { record: false }),
    );
    const signedIn = await api.post(
      "/auth/verification/confirm",
      { email: user.email, purpose: "login", code },
      { record: false },
    );
    api.token = signedIn.data.accessToken;
    const reset = await codeAfter(user.email, () =>
      app.api.post("/auth/password/forgot", { email: user.email }),
    );
    await ageCode(app, user.email, "password_reset", 601);
    const result = await step("POST /auth/password/change with the old code", () =>
      api.post("/auth/password/change", { newPassword: NEW_PASSWORD, code: reset }),
    );
    await step("It answers 400 CODE_EXPIRED", async () => {
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_EXPIRED");
    });
  },
);

test(
  "changing the email takes a code from the new address and moves the account",
  {
    tag: ["@auth", "@smoke"],
    annotation: about(
      "POST /auth/email/change with the current password sends a code to the new address. Confirming it moves the account, marks the new email verified, emails the old address and keeps every session signed in. Access tokens carry the old email until refreshed.",
    ),
  },
  async () => {
    const user = await app.user("mover", { signIn: false });
    const laptop = await app.userSession(user.email, PASSWORD, "laptop");
    const phone = await app.userSession(user.email, PASSWORD, "phone");
    const newEmail = app.email("moved");
    const oldMails = await app.mail.count(user.email);
    const requested = await step("POST /auth/email/change with the new address and the password", () =>
      laptop.api.post("/auth/email/change", { newEmail: newEmail.toUpperCase(), password: PASSWORD }),
    );
    await step("It answers 200 EMAIL_CHANGE_CODE_SENT", async () => {
      expect(requested.status).toBe(200);
      expect(requested.message).toBe("EMAIL_CHANGE_CODE_SENT");
    });
    await step("The code went to the new address, lowercased", async () => {
      const mail = await app.mail.last(newEmail);
      expect(mail.subject).toBe("Confirm your new Dopgate email");
      expect(mail.text).toContain(newEmail);
      expect(await app.mail.count(user.email)).toBe(oldMails);
    });
    await step("Nothing changed before the code is confirmed", async () => {
      const me = await laptop.api.get("/auth/me");
      expect(me.data.email).toBe(user.email);
    });
    await step("A wrong code is CODE_INVALID, and a code for the old address too", async () => {
      const wrong = await app.api.post("/auth/verification/confirm", {
        email: newEmail,
        purpose: "email_change",
        code: "000000",
      });
      expect(wrong.status).toBe(400);
      expect(wrong.code).toBe("CODE_INVALID");
      const old = await app.api.post("/auth/verification/confirm", {
        email: user.email,
        purpose: "email_change",
        code: await app.mail.code(newEmail),
      });
      expect(old.code).toBe("CODE_INVALID");
    });
    const confirmed = await step("POST /auth/verification/confirm with purpose email_change", async () =>
      app.api.post("/auth/verification/confirm", {
        email: newEmail,
        purpose: "email_change",
        code: await app.mail.code(newEmail),
      }),
    );
    await step("It answers 200 EMAIL_CHANGED with the updated user", async () => {
      expect(confirmed.status).toBe(200);
      expect(confirmed.message).toBe("EMAIL_CHANGED");
      expect(confirmed.data).toMatchObject({ id: user.id, email: newEmail, emailVerified: true });
      expect(confirmed.data).not.toHaveProperty("accessToken");
    });
    await step("The old address was told", async () => {
      const mail = await app.mail.last(user.email, { after: oldMails });
      expect(mail.subject).toBe("Your Dopgate email was changed");
      expect(mail.text).toContain(user.email);
      expect(mail.text).toContain(newEmail);
    });
    await step("Both sessions stay signed in and GET /auth/me shows the new email", async () => {
      for (const device of [laptop, phone]) {
        const me = await device.api.get("/auth/me");
        expect(me.status).toBe(200);
        expect(me.data.email).toBe(newEmail);
      }
    });
    await step("An old access token still says the old email, a refreshed one the new", async () => {
      expect(claims(laptop.tokens.accessToken).email).toBe(user.email);
      const refreshed = await laptop.api.post("/auth/refresh", { refreshToken: laptop.tokens.refreshToken });
      expect(claims(refreshed.data.accessToken).email).toBe(newEmail);
      expect(claims(refreshed.data.accessToken).sub).toBe(user.id);
    });
    await step("Sign-in works with the new email and fails with the old one", async () => {
      expect((await app.api.post("/auth/login", { email: newEmail, password: PASSWORD })).status).toBe(200);
      const old = await app.api.post("/auth/login", { email: user.email, password: PASSWORD });
      expect(old.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("The audit log records user.email_changed with both addresses", async () => {
      const events = await auditEvents(app, "user.email_changed", newEmail);
      expect(events).toHaveLength(1);
      expect(events[0]!.metadata).toEqual({ from: user.email, to: newEmail });
    });
    await step("The old address can be used for a new account", async () => {
      const result = await app.api.post("/auth/signup", { email: user.email, password: PASSWORD });
      expect(result.status).toBe(201);
    });
    await step("The code works once", async () => {
      const again = await app.api.post("/auth/verification/confirm", {
        email: newEmail,
        purpose: "email_change",
        code: await app.mail.code(newEmail),
      });
      expect(again.code).toBe("CODE_INVALID");
    });
  },
);

test(
  "an email change refuses a taken address, a bad address and a wrong password",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "The request answers 409 EMAIL_TAKEN for an address another account uses, 422 EMAIL_INVALID for text that is not an email or the account's own address, and 401 for a wrong or missing password. No code is sent in any of these cases.",
    ),
  },
  async () => {
    const user = await app.user("asker");
    const taken = await app.user("holder");
    const change = (body: Record<string, unknown>) => user.api.post("/auth/email/change", body);
    await step("An address another account holds is 409 EMAIL_TAKEN", async () => {
      const result = await change({ newEmail: taken.email.toUpperCase(), password: PASSWORD });
      expect(result.status).toBe(409);
      expect(result.code).toBe("EMAIL_TAKEN");
    });
    await step("Text that is not an email is 422 EMAIL_INVALID", async () => {
      const result = await change({ newEmail: "not-an-email", password: PASSWORD });
      expect(result.status).toBe(422);
      expect(result.code).toBe("EMAIL_INVALID");
    });
    await step("The account's own address is 422 EMAIL_INVALID", async () => {
      const result = await change({ newEmail: user.email, password: PASSWORD });
      expect(result.status).toBe(422);
      expect(result.code).toBe("EMAIL_INVALID");
    });
    await step("A wrong password is 401 AUTHENTICATION_INVALID", async () => {
      const result = await change({ newEmail: app.email("fresh"), password: "not mine" });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("A missing password is 401 AUTHENTICATION_INVALID", async () => {
      const result = await change({ newEmail: app.email("fresh") });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("Without a token the route is 401", async () => {
      const result = await app.api.post("/auth/email/change", {
        newEmail: app.email("fresh"),
        password: PASSWORD,
      });
      expect(result.status).toBe(401);
    });
    await step("Two wrong passwords left two password_check_failed events", async () => {
      const events = await auditEvents(app, "user.password_check_failed", user.email);
      expect(events).toHaveLength(2);
    });
  },
);

test(
  "an address taken between the request and the code is refused at confirmation",
  {
    tag: ["@auth"],
    annotation: about(
      "The address is checked again when the code is confirmed. If someone else registered it in the meantime, the confirmation answers 409 EMAIL_TAKEN and the account keeps its email.",
    ),
  },
  async () => {
    const user = await app.user("racer");
    const target = app.email("contested");
    await user.api.post("/auth/email/change", { newEmail: target, password: PASSWORD });
    const code = await app.mail.code(target);
    await step("Someone else signs up with the address", async () => {
      await app.service.must("POST", "/admin/users", { email: target, password: PASSWORD, emailVerified: true }, {
        record: false,
      });
    });
    await step("Confirming the code answers 409 EMAIL_TAKEN", async () => {
      const result = await app.api.post("/auth/verification/confirm", {
        email: target,
        purpose: "email_change",
        code,
      });
      expect(result.status).toBe(409);
      expect(result.code).toBe("EMAIL_TAKEN");
    });
    await step("The account still has its old email", async () => {
      const me = await user.api.get("/auth/me");
      expect(me.data.email).toBe(user.email);
    });
  },
);

test(
  "an account with no password changes its email with just the code",
  {
    tag: ["@auth"],
    annotation: about(
      "The password is only required when the account has one. A code-only account asks for the change with no password, and the code sent to the new address is the proof.",
    ),
  },
  async () => {
    const user = await app.user("codeonly", { password: false });
    const api = await app.newApi("codeonly");
    const login = await codeAfter(user.email, () =>
      api.post("/auth/verification/send", { email: user.email, purpose: "login" }, { record: false }),
    );
    const signedIn = await api.post(
      "/auth/verification/confirm",
      { email: user.email, purpose: "login", code: login },
      { record: false },
    );
    api.token = signedIn.data.accessToken;
    const newEmail = app.email("passwordless");
    await step("POST /auth/email/change with no password", async () => {
      const result = await api.post("/auth/email/change", { newEmail });
      expect(result.status).toBe(200);
      expect(result.message).toBe("EMAIL_CHANGE_CODE_SENT");
    });
    await step("Confirming the code moves the account", async () => {
      const result = await app.api.post("/auth/verification/confirm", {
        email: newEmail,
        purpose: "email_change",
        code: await app.mail.code(newEmail),
      });
      expect(result.status).toBe(200);
      expect(result.data).toMatchObject({ id: user.id, email: newEmail, hasPassword: false });
    });
    await step("The session's token still works", async () => {
      expect((await api.get("/auth/me")).data.email).toBe(newEmail);
    });
  },
);
