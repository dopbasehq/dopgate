import {
  about,
  expect,
  LEAKED_PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims } from "../harness/helpers.ts";
import {
  addAdmin,
  auditEvent,
  emailedLoginCode,
  expectError,
  PASSWORD,
  ROOT_EMAIL,
} from "./console.support.ts";

const app = useServer();

test(
  "GET /console/me returns the signed-in admin",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "The console's own account route answers with the admin behind the token, in the admin shape: an adm_ id, a role, a status and whether the admin has a password. Without a console token it refuses.",
    ),
  },
  async () => {
    const root = await app.root();
    const sam = await app.admin("sam", { displayName: "Sam" });
    await step("GET /console/me as root", async () => {
      const me = await root.api.get("/console/me");
      expect(me.status).toBe(200);
      expect(me.message).toBe("ACCOUNT_FETCHED");
      expect(me.data).toMatchObject({
        id: root.id,
        email: ROOT_EMAIL,
        role: "root",
        status: "active",
        hasPassword: true,
        lockedUntil: null,
      });
    });
    await step("GET /console/me as an admin", async () => {
      const me = await sam.api.get("/console/me");
      expect(me.data).toMatchObject({
        id: sam.id,
        email: sam.email,
        displayName: "Sam",
        role: "admin",
      });
      expect(me.data.id).toMatch(/^adm_/);
      expect(me.data.lastSignInAt).toBeTruthy();
    });
    await step("GET /console/me with no token", async () => {
      expectError(
        await app.api.get("/console/me"),
        401,
        "AUTHENTICATION_REQUIRED",
      );
    });
    await step("GET /console/me with a token that is not one", async () => {
      expectError(
        await app.api.get("/console/me", { token: "not-a-token" }),
        401,
        "AUTHENTICATION_INVALID",
      );
    });
  },
);

test(
  "PATCH /console/me changes the profile and leaves other fields alone",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "An admin sets their display name and avatar. A field left out stays as it is, an empty string clears it, and the change is audited as admin.profile_updated.",
    ),
  },
  async () => {
    const sam = await app.admin("pat");
    await step("PATCH /console/me with a name and an avatar", async () => {
      const result = await sam.api.patch("/console/me", {
        displayName: "Pat Doe",
        avatarUrl: "https://example.com/pat.png",
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("PROFILE_UPDATED");
      expect(result.data).toMatchObject({
        displayName: "Pat Doe",
        avatarUrl: "https://example.com/pat.png",
        email: sam.email,
      });
    });
    await step("PATCH /console/me with only the name keeps the avatar", async () => {
      const result = await sam.api.patch("/console/me", { displayName: "Pat" });
      expect(result.data.displayName).toBe("Pat");
      expect(result.data.avatarUrl).toBe("https://example.com/pat.png");
    });
    await step("PATCH /console/me with empty strings clears both", async () => {
      const result = await sam.api.patch("/console/me", {
        displayName: "",
        avatarUrl: "",
      });
      expect(result.status).toBe(200);
      expect(result.data.displayName).toBeNull();
      expect(result.data.avatarUrl).toBeNull();
    });
    await step("GET /console/me shows what was saved", async () => {
      const me = await sam.api.get("/console/me");
      expect(me.data.displayName).toBeNull();
    });
    await step("The change is audited as admin.profile_updated", async () => {
      const event = await auditEvent(
        app,
        "admin.profile_updated",
        (e) => e.actorLabel === sam.email,
      );
      expect(event).toMatchObject({ actorType: "admin", resourceType: "admin" });
    });
    await step("PATCH /console/me with no token", async () => {
      expectError(
        await app.api.patch("/console/me", { displayName: "Nobody" }),
        401,
        "AUTHENTICATION_REQUIRED",
      );
    });
  },
);

test(
  "PATCH /console/me refuses a display name or avatar that is not valid",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "A name must be one line of at most 255 characters and an avatar must be an http or https URL of at most 2048 characters. Nothing is saved when one is refused.",
    ),
  },
  async () => {
    const sam = await app.admin("val", { displayName: "Val" });
    const refused: [string, Record<string, unknown>][] = [
      ["a name with a line break", { displayName: "two\nlines" }],
      ["a name of 256 characters", { displayName: "x".repeat(256) }],
      ["an avatar that is not http", { avatarUrl: "ftp://example.com/a.png" }],
      ["an avatar without a scheme", { avatarUrl: "example.com/a.png" }],
      [
        "an avatar over 2048 characters",
        { avatarUrl: `https://example.com/${"a".repeat(2048)}` },
      ],
    ];
    for (const [what, body] of refused) {
      await step(`PATCH /console/me with ${what}`, async () => {
        expectError(await sam.api.patch("/console/me", body), 422, "PROFILE_INVALID");
      });
    }
    await step("Nothing was saved by the refused calls", async () => {
      const me = await sam.api.get("/console/me");
      expect(me.data.displayName).toBe("Val");
      expect(me.data.avatarUrl).toBeNull();
    });
    await step("A name of 255 characters is accepted", async () => {
      const result = await sam.api.patch("/console/me", {
        displayName: "x".repeat(255),
      });
      expect(result.status).toBe(200);
    });
  },
);

test(
  "changing the password ends the other sessions and keeps this one",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "An admin proves the current password to set a new one. Every other console session ends, the session that asked stays, the old password stops working, and a notice goes to the admin's email.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "chg" });
    const here = await app.consoleSession(admin.email);
    const there = await app.consoleSession(admin.email);
    const next = "a brand new passphrase";
    const mails = await app.mail.count(admin.email);
    await step("POST /console/password/change with the current password", async () => {
      const result = await here.api.post("/console/password/change", {
        currentPassword: PASSWORD,
        newPassword: next,
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("PASSWORD_CHANGED");
      expect(result.data).toBeNull();
    });
    await step("This session still works, the other one ended", async () => {
      expect((await here.api.get("/console/me")).status).toBe(200);
      expectError(await there.api.get("/console/me"), 401, "TOKEN_INVALID");
    });
    await step("The old password is refused and the new one signs in", async () => {
      const old = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(old, 401, "AUTHENTICATION_INVALID");
      const fresh = await app.api.post("/console/login", {
        email: admin.email,
        password: next,
      });
      expect(fresh.status).toBe(200);
    });
    await step("A password_changed email went out", async () => {
      const mail = await app.mail.last(admin.email, { after: mails });
      expect(mail.subject).toMatch(/password was changed/i);
    });
    await step("The change is audited with the sessions it ended", async () => {
      const event = await auditEvent(
        app,
        "admin.password_changed",
        (e) => e.actorLabel === admin.email,
      );
      expect(event.metadata.otherSessionsEnded).toBe(1);
    });
  },
);

test(
  "changing the password refuses a wrong current password and a bad new one",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "A wrong current password is a 401 that counts toward the lockout and is audited as admin.password_check_failed. A new password that is too short, on the leaked list, or missing is refused, and the old password keeps working.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "bad" });
    const session = await app.consoleSession(admin.email);
    await step("POST /console/password/change with a wrong current password", async () => {
      const result = await session.api.post("/console/password/change", {
        currentPassword: "not the right password",
        newPassword: "a brand new passphrase",
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
    await step("It is audited as admin.password_check_failed", async () => {
      const event = await auditEvent(
        app,
        "admin.password_check_failed",
        (e) => e.actorLabel === admin.email,
      );
      expect(event.metadata).toMatchObject({ reason: "password", locked: false });
    });
    await step("POST /console/password/change with a new password that is too short", async () => {
      const result = await session.api.post("/console/password/change", {
        currentPassword: PASSWORD,
        newPassword: "short",
      });
      expectError(result, 422, "PASSWORD_INVALID");
    });
    await step("POST /console/password/change with a leaked new password", async () => {
      const result = await session.api.post("/console/password/change", {
        currentPassword: PASSWORD,
        newPassword: LEAKED_PASSWORD,
      });
      expectError(result, 422, "PASSWORD_LEAKED");
    });
    await step("POST /console/password/change without a new password", async () => {
      const result = await session.api.post("/console/password/change", {
        currentPassword: PASSWORD,
      });
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("POST /console/password/change with no token", async () => {
      const result = await app.api.post("/console/password/change", {
        currentPassword: PASSWORD,
        newPassword: "a brand new passphrase",
      });
      expectError(result, 401, "AUTHENTICATION_REQUIRED");
    });
    await step("The old password still signs in", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expect(result.status).toBe(200);
    });
  },
);

test(
  "wrong current passwords on a password change lock the account",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "A wrong current password counts toward the same lockout as a wrong sign-in. Once the account is locked, even the right current password is refused until the lock runs out or a reset clears it.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "chglock" });
    const session = await app.consoleSession(admin.email);
    await step("Five wrong current passwords on POST /console/password/change", async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = await session.api.post("/console/password/change", {
          currentPassword: "not the right password",
          newPassword: "a brand new passphrase",
        });
        expectError(result, 401, "AUTHENTICATION_INVALID");
      }
    });
    await step("The right current password is now refused", async () => {
      const result = await session.api.post("/console/password/change", {
        currentPassword: PASSWORD,
        newPassword: "a brand new passphrase",
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
    await step("The last check is audited as locked", async () => {
      const event = await auditEvent(
        app,
        "admin.password_check_failed",
        (e) => e.actorLabel === admin.email && e.metadata.reason === "locked",
      );
      expect(event.actorType).toBe("admin");
    });
    await step("The sign-in route is locked too", async () => {
      const result = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
  },
);

test(
  "an admin without a password sets one with an emailed code",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "An admin who signs in by code has no password to confirm. They ask for a reset code on /console/password/forgot and send it with the new password to /console/password/change. Without the code, or with a wrong one, nothing changes.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "nopw", password: false });
    const code = await emailedLoginCode(app, admin.email);
    const signedIn = await app.api.post("/console/codes/confirm", {
      email: admin.email,
      purpose: "login",
      code,
    });
    expect(signedIn.status).toBe(200);
    const api = await app.newApi("nopw", signedIn.data.accessToken);
    const next = "a brand new passphrase";
    await step("POST /console/password/change with no code", async () => {
      const result = await api.post("/console/password/change", {
        newPassword: next,
      });
      expectError(result, 400, "CODE_INVALID");
    });
    await step("POST /console/password/change with a wrong code", async () => {
      const result = await api.post("/console/password/change", {
        code: "123456",
        newPassword: next,
      });
      expectError(result, 400, "CODE_INVALID");
    });
    const reset = await step("POST /console/password/forgot sends a reset code", async () => {
      const before = await app.mail.count(admin.email);
      const forgot = await app.api.post("/console/password/forgot", {
        email: admin.email,
      });
      expect(forgot.status).toBe(200);
      const mail = await app.mail.last(admin.email, { after: before });
      expect(mail.subject).toMatch(/reset/i);
      return app.mail.code(admin.email, { after: before });
    });
    await step("POST /console/password/change with the code and a leaked password", async () => {
      const result = await api.post("/console/password/change", {
        code: reset,
        newPassword: LEAKED_PASSWORD,
      });
      expectError(result, 422, "PASSWORD_LEAKED");
    });
    await step("POST /console/password/change with the code", async () => {
      const result = await api.post("/console/password/change", {
        code: reset,
        newPassword: next,
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("PASSWORD_CHANGED");
    });
    await step("The admin now has a password and signs in with it", async () => {
      expect((await api.get("/console/me")).data.hasPassword).toBe(true);
      const login = await app.api.post("/console/login", {
        email: admin.email,
        password: next,
      });
      expect(login.status).toBe(200);
    });
    await step("The code is no use now that the account has a password", async () => {
      const again = await api.post("/console/password/change", {
        code: reset,
        newPassword: "yet another passphrase",
      });
      expectError(again, 401, "AUTHENTICATION_INVALID");
    });
  },
);

test(
  "forgot password answers alike for any email and sends mail only to admins",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "POST /console/password/forgot always answers PASSWORD_RESET_SENT, whether the email belongs to an admin, to nobody, or only to a user of the app. Only an admin gets a reset email, and a malformed email is refused.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "fgt" });
    const user = await app.user("fgt-user");
    const stranger = app.email("stranger");
    const known = await step("POST /console/password/forgot for an admin", () =>
      app.api.post("/console/password/forgot", { email: admin.email }),
    );
    const unknown = await step("POST /console/password/forgot for an unknown email", () =>
      app.api.post("/console/password/forgot", { email: stranger }),
    );
    const appUser = await step("POST /console/password/forgot for a user of the app", () =>
      app.api.post("/console/password/forgot", { email: user.email }),
    );
    await step("The three answers match", async () => {
      expect(known.status).toBe(200);
      expect(known.message).toBe("PASSWORD_RESET_SENT");
      expect(unknown.body).toEqual(known.body);
      expect(appUser.body).toEqual(known.body);
    });
    await step("Only the admin got a reset email", async () => {
      const mail = await app.mail.last(admin.email);
      expect(mail.subject).toMatch(/reset/i);
      await expect.poll(async () => (await app.mail.to(stranger)).length).toBe(0);
      const userMails = (await app.mail.to(user.email)).filter((m) =>
        /reset/i.test(m.subject),
      );
      expect(userMails).toHaveLength(0);
    });
    await step("POST /console/password/forgot with a bad email", async () => {
      expectError(
        await app.api.post("/console/password/forgot", { email: "nope" }),
        422,
        "EMAIL_INVALID",
      );
    });
  },
);

test(
  "resetting the password ends every console session",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "A reset with the emailed code sets a new password and ends every console session of the admin, including ones that were open, and the email counts as verified. The code works once. The app's reset route doesn't take it.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "rst" });
    const one = await app.consoleSession(admin.email);
    const two = await app.consoleSession(admin.email);
    const bystander = await app.admin("rst-by");
    const next = "a brand new passphrase";
    const before = await app.mail.count(admin.email);
    await app.api.post("/console/password/forgot", { email: admin.email });
    const code = await app.mail.code(admin.email, { after: before });
    await step("POST /auth/password/reset does not take a console code", async () => {
      const result = await app.api.post("/auth/password/reset", {
        email: admin.email,
        code,
        newPassword: next,
      });
      expect(result.status).toBe(400);
      expect(result.code).toBe("CODE_INVALID");
    });
    await step("POST /console/password/reset with a wrong code", async () => {
      const result = await app.api.post("/console/password/reset", {
        email: admin.email,
        code: code === "000000" ? "111111" : "000000",
        newPassword: next,
      });
      expectError(result, 400, "CODE_INVALID");
    });
    await step("POST /console/password/reset with a too short password", async () => {
      const result = await app.api.post("/console/password/reset", {
        email: admin.email,
        code,
        newPassword: "short",
      });
      expectError(result, 422, "PASSWORD_INVALID");
    });
    await step("POST /console/password/reset with a leaked password", async () => {
      const result = await app.api.post("/console/password/reset", {
        email: admin.email,
        code,
        newPassword: LEAKED_PASSWORD,
      });
      expectError(result, 422, "PASSWORD_LEAKED");
    });
    await step("POST /console/password/reset with the code", async () => {
      const result = await app.api.post("/console/password/reset", {
        email: admin.email,
        code,
        newPassword: next,
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("PASSWORD_RESET");
    });
    await step("Every session of the admin ended, another admin's did not", async () => {
      for (const session of [one, two]) {
        expectError(await session.api.get("/console/me"), 401, "TOKEN_INVALID");
      }
      expect((await bystander.api.get("/console/me")).status).toBe(200);
    });
    await step("The old password is refused and the new one signs in", async () => {
      const old = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(old, 401, "AUTHENTICATION_INVALID");
      const fresh = await app.api.post("/console/login", {
        email: admin.email,
        password: next,
      });
      expect(fresh.status).toBe(200);
    });
    await step("The code can't be used a second time", async () => {
      const again = await app.api.post("/console/password/reset", {
        email: admin.email,
        code,
        newPassword: "yet another passphrase",
      });
      expectError(again, 400, "CODE_INVALID");
    });
    await step("The reset is audited as admin.password_reset", async () => {
      const event = await auditEvent(
        app,
        "admin.password_reset",
        (e) => e.actorLabel === admin.email,
      );
      expect(event.metadata.sessionsEnded).toBeGreaterThanOrEqual(2);
    });
  },
);

test(
  "an admin changes their email with a code sent to the new address",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "POST /console/email/change mails a code to the new address, and /console/codes/confirm with purpose email_change moves the account. The old address gets a notice, the session stays open, and the old email no longer signs in.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "mv" });
    const session = await app.consoleSession(admin.email);
    const newEmail = app.email("moved");
    await step("POST /console/email/change with the password", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail,
        password: PASSWORD,
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("EMAIL_CHANGE_CODE_SENT");
    });
    const code = await step("A code arrives at the new address, none yet moved", async () => {
      const mail = await app.mail.last(newEmail);
      expect(mail.subject).toMatch(/confirm your new/i);
      expect((await session.api.get("/console/me")).data.email).toBe(admin.email);
      return app.mail.code(newEmail);
    });
    await step("POST /console/codes/confirm with a wrong code", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: newEmail,
        purpose: "email_change",
        code: code === "000000" ? "111111" : "000000",
      });
      expectError(result, 400, "CODE_INVALID");
    });
    await step("POST /console/codes/confirm with purpose email_change", async () => {
      const result = await app.api.post("/console/codes/confirm", {
        email: newEmail,
        purpose: "email_change",
        code,
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("EMAIL_CHANGED");
      expect(result.data.email).toBe(newEmail);
      expect(result.data.id).toBe(admin.id);
      expect(result.data.accessToken).toBeUndefined();
    });
    await step("GET /console/me shows the new email and the session stays open", async () => {
      expect((await session.api.get("/console/me")).data.email).toBe(newEmail);
    });
    await step("The old address gets an email_changed notice", async () => {
      await expect
        .poll(async () =>
          (await app.mail.to(admin.email)).some((m) =>
            /email was changed/i.test(m.subject),
          ),
        )
        .toBe(true);
    });
    await step("Sign-in works with the new email and not the old one", async () => {
      const fresh = await app.api.post("/console/login", {
        email: newEmail,
        password: PASSWORD,
      });
      expect(fresh.status).toBe(200);
      const old = await app.api.post("/console/login", {
        email: admin.email,
        password: PASSWORD,
      });
      expectError(old, 401, "AUTHENTICATION_INVALID");
    });
    await step("The change is audited as admin.email_changed", async () => {
      const event = await auditEvent(
        app,
        "admin.email_changed",
        (e) => e.metadata.to === newEmail,
      );
      expect(event.metadata.from).toBe(admin.email);
    });
    await step("The code can't be used twice", async () => {
      const again = await app.api.post("/console/codes/confirm", {
        email: newEmail,
        purpose: "email_change",
        code,
      });
      expectError(again, 400, "CODE_INVALID");
    });
  },
);

test(
  "an email change is refused when another admin uses the address",
  {
    tag: ["@console", "@admins"],
    annotation: about(
      "The new address has to be free among admins. A taken address, the admin's own address and a malformed one are refused when asking, and an address someone takes while the code is out is refused when confirming.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "take" });
    const other = await addAdmin(app, { name: "holder" });
    const session = await app.consoleSession(admin.email);
    await step("POST /console/email/change to another admin's email", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail: other.email,
        password: PASSWORD,
      });
      expectError(result, 409, "EMAIL_TAKEN");
    });
    await step("POST /console/email/change to root's email in capitals", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail: ROOT_EMAIL.toUpperCase(),
        password: PASSWORD,
      });
      expectError(result, 409, "EMAIL_TAKEN");
    });
    await step("POST /console/email/change to the admin's own email", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail: admin.email,
        password: PASSWORD,
      });
      expectError(result, 422, "EMAIL_INVALID");
    });
    await step("POST /console/email/change to something that is not an email", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail: "not-an-email",
        password: PASSWORD,
      });
      expectError(result, 422, "EMAIL_INVALID");
    });
    await step("POST /console/email/change with a wrong password", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail: app.email("free"),
        password: "not the right password",
      });
      expectError(result, 401, "AUTHENTICATION_INVALID");
    });
    await step("POST /console/email/change with no token", async () => {
      const result = await app.api.post("/console/email/change", {
        newEmail: app.email("free"),
        password: PASSWORD,
      });
      expectError(result, 401, "AUTHENTICATION_REQUIRED");
    });
    await step("Another admin takes the address while the code is out", async () => {
      const wanted = app.email("race");
      const sent = await session.api.post("/console/email/change", {
        newEmail: wanted,
        password: PASSWORD,
      });
      expect(sent.status).toBe(200);
      const code = await app.mail.code(wanted);
      await addAdmin(app, { email: wanted });
      const result = await app.api.post("/console/codes/confirm", {
        email: wanted,
        purpose: "email_change",
        code,
      });
      expectError(result, 409, "EMAIL_TAKEN");
      expect((await session.api.get("/console/me")).data.email).toBe(admin.email);
    });
  },
);

test(
  "an admin may take the email of a user of the app",
  {
    tag: ["@console", "@users"],
    annotation: about(
      "Admins and users are separate accounts, so an admin can move to an address a user already has. Both keep signing in on their own side.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "share" });
    const user = await app.user("sharer");
    const session = await app.consoleSession(admin.email);
    const mails = await app.mail.count(user.email);
    await step("POST /console/email/change to a user's email", async () => {
      const result = await session.api.post("/console/email/change", {
        newEmail: user.email,
        password: PASSWORD,
      });
      expect(result.status).toBe(200);
    });
    await step("POST /console/codes/confirm moves the admin", async () => {
      const code = await app.mail.code(user.email, { after: mails });
      const result = await app.api.post("/console/codes/confirm", {
        email: user.email,
        purpose: "email_change",
        code,
      });
      expect(result.status).toBe(200);
      expect(result.data.email).toBe(user.email);
    });
    await step("Both accounts sign in on their own side", async () => {
      const asAdmin = await app.api.post("/console/login", {
        email: user.email,
        password: PASSWORD,
      });
      expect(asAdmin.data.admin.id).toBe(admin.id);
      const asUser = await app.api.post("/auth/login", {
        email: user.email,
        password: PASSWORD,
      });
      expect(asUser.data.user.id).toBe(user.id);
    });
  },
);

test(
  "GET /console/sessions lists the admin's own sessions",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "The list holds only this admin's open sessions. The one making the request is marked current, and an ended session drops out.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "ses" });
    const first = await app.consoleSession(admin.email);
    const second = await app.consoleSession(admin.email);
    const stranger = await app.admin("ses-other");
    await step("GET /console/sessions from the first session", async () => {
      const list = await first.api.get("/console/sessions");
      expect(list.status).toBe(200);
      expect(list.message).toBe("SESSIONS_FETCHED");
      expect(list.data).toHaveLength(2);
      const ids = list.data.map((s: { id: string }) => s.id);
      expect(ids).toContain(claims(first.tokens.accessToken).sid);
      expect(ids).toContain(claims(second.tokens.accessToken).sid);
      const current = list.data.filter((s: { current: boolean }) => s.current);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(claims(first.tokens.accessToken).sid);
      expect(current[0]).toMatchObject({ method: "password" });
      expect(current[0].id).toMatch(/^ses_/);
      expect(current[0].expiresAt).toBeTruthy();
      expect(current[0].lastUsedAt).toBeTruthy();
    });
    await step("The other admin's session is not in it", async () => {
      const list = await first.api.get("/console/sessions");
      const ids = list.data.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(claims(stranger.tokens.accessToken).sid);
    });
    await step("GET /console/sessions with no token", async () => {
      expectError(
        await app.api.get("/console/sessions"),
        401,
        "AUTHENTICATION_REQUIRED",
      );
    });
  },
);

test(
  "DELETE /console/sessions/{id} ends one session",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "An admin signs another device out by its session id. That device's tokens stop working, the rest stay, and an unknown id or another admin's session is a 404.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "one" });
    const first = await app.consoleSession(admin.email);
    const second = await app.consoleSession(admin.email);
    const stranger = await app.admin("one-other");
    const secondId = claims(second.tokens.accessToken).sid;
    await step("DELETE /console/sessions/{id} for another device", async () => {
      const result = await first.api.delete(`/console/sessions/${secondId}`);
      expect(result.status).toBe(200);
      expect(result.message).toBe("SESSION_REVOKED");
    });
    await step("That device is signed out and the list no longer shows it", async () => {
      expectError(await second.api.get("/console/me"), 401, "TOKEN_INVALID");
      const refresh = await app.api.post("/console/refresh", {
        refreshToken: second.tokens.refreshToken,
      });
      expectError(refresh, 401, "TOKEN_INVALID");
      const list = await first.api.get("/console/sessions");
      expect(list.data.map((s: { id: string }) => s.id)).not.toContain(secondId);
    });
    await step("DELETE /console/sessions/{id} again", async () => {
      expectError(
        await first.api.delete(`/console/sessions/${secondId}`),
        404,
        "NOT_FOUND",
      );
    });
    await step("DELETE /console/sessions/{id} with an unknown id", async () => {
      expectError(
        await first.api.delete("/console/sessions/ses_00000000000000000000000000"),
        404,
        "NOT_FOUND",
      );
    });
    await step("DELETE /console/sessions/{id} with another admin's session", async () => {
      const result = await first.api.delete(
        `/console/sessions/${claims(stranger.tokens.accessToken).sid}`,
      );
      expectError(result, 404, "NOT_FOUND");
      expect((await stranger.api.get("/console/me")).status).toBe(200);
    });
    await step("The revoke is audited as session.revoked", async () => {
      const event = await auditEvent(
        app,
        "session.revoked",
        (e) => e.resourceId === secondId,
      );
      expect(event.actorLabel).toBe(admin.email);
      expect(event.resourceType).toBe("session");
    });
    await step("An admin can end their own current session", async () => {
      const own = claims(first.tokens.accessToken).sid;
      expect((await first.api.delete(`/console/sessions/${own}`)).status).toBe(200);
      expectError(await first.api.get("/console/me"), 401, "TOKEN_INVALID");
    });
  },
);

test(
  "DELETE /console/sessions ends every session, or every other one with keepCurrent",
  {
    tag: ["@console", "@auth"],
    annotation: about(
      "Sign out everywhere ends all of an admin's sessions, this one included. With keepCurrent=true the session making the call stays. Both are audited as session.revoked_all with the count.",
    ),
  },
  async () => {
    const admin = await addAdmin(app, { name: "all" });
    const first = await app.consoleSession(admin.email);
    const second = await app.consoleSession(admin.email);
    const third = await app.consoleSession(admin.email);
    const bystander = await app.admin("all-other");
    await step("DELETE /console/sessions?keepCurrent=true", async () => {
      const result = await first.api.delete("/console/sessions?keepCurrent=true");
      expect(result.status).toBe(200);
      expect(result.message).toBe("SESSIONS_REVOKED");
    });
    await step("Only the calling session is left", async () => {
      expect((await first.api.get("/console/me")).status).toBe(200);
      expectError(await second.api.get("/console/me"), 401, "TOKEN_INVALID");
      expectError(await third.api.get("/console/me"), 401, "TOKEN_INVALID");
      const list = await first.api.get("/console/sessions");
      expect(list.data).toHaveLength(1);
    });
    await step("The keepCurrent call is audited", async () => {
      const event = await auditEvent(
        app,
        "session.revoked_all",
        (e) => e.actorLabel === admin.email && e.metadata.keptCurrent === true,
      );
      expect(event.metadata.sessions).toBe(2);
    });
    const fourth = await app.consoleSession(admin.email);
    await step("DELETE /console/sessions", async () => {
      const result = await first.api.delete("/console/sessions");
      expect(result.status).toBe(200);
      expect(result.message).toBe("SESSIONS_REVOKED");
    });
    await step("Every session of the admin ended, another admin's did not", async () => {
      expectError(await first.api.get("/console/me"), 401, "TOKEN_INVALID");
      expectError(await fourth.api.get("/console/me"), 401, "TOKEN_INVALID");
      expect((await bystander.api.get("/console/me")).status).toBe(200);
    });
    await step("The full sign-out is audited with keptCurrent false", async () => {
      const event = await auditEvent(
        app,
        "session.revoked_all",
        (e) => e.actorLabel === admin.email && e.metadata.keptCurrent === false,
      );
      expect(event.metadata.sessions).toBe(2);
    });
  },
);
