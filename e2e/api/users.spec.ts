import { claims } from "../harness/helpers.ts";
import {
  LEAKED_PASSWORD,
  PASSWORD,
  about,
  expect,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { USER_FIELDS, eventsOf, metadataOfSize } from "./admin.support.ts";

const app = useServer();

test(
  "the service key creates a user without sending any email",
  {
    tag: ["@users", "@smoke"],
    annotation: about(
      "A backend creates an account with POST /admin/users. The email is not verified by default, no message goes out, and the audit log names the service key as the actor.",
    ),
  },
  async () => {
    const email = app.email("made");
    const created = await step("POST /admin/users as a backend", () =>
      app.service.post("/admin/users", {
        email,
        password: PASSWORD,
        displayName: "Made By Backend",
      }),
    );
    await step("It answers 201 USER_CREATED with the admin view", async () => {
      expect(created.status).toBe(201);
      expect(created.message).toBe("USER_CREATED");
      expect(created.data).toMatchObject({
        email,
        displayName: "Made By Backend",
        emailVerified: false,
        status: "active",
        hasPassword: true,
        avatarUrl: null,
        lastSignInAt: null,
        userMetadata: {},
        publicMetadata: {},
        privateMetadata: {},
        lockedUntil: null,
      });
      expect(created.data.id).toMatch(/^usr_/);
    });
    await step("No email was sent", async () => {
      await new Promise((wait) => setTimeout(wait, 300));
      expect(await app.mail.count(email)).toBe(0);
    });
    await step("The audit log has user.created by the service key", async () => {
      const [event] = await eventsOf(app.service, "user.created");
      expect(event).toMatchObject({
        actorType: "service",
        actorLabel: "service",
        resourceType: "user",
        resourceId: created.data.id,
        metadata: { email },
      });
    });
    await step("Until the email is verified, sign-in is refused", async () => {
      const api = await app.newApi("made");
      const refused = await api.signIn("/auth/login", email, PASSWORD);
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("EMAIL_NOT_VERIFIED");
    });
  },
);

test(
  "an admin creates a verified user with metadata, who can sign in",
  {
    tag: "@users",
    annotation: about(
      "Root creates an account with emailVerified true, a display name and both metadata objects. The user signs in at once, and the audit log names root.",
    ),
  },
  async () => {
    const root = await app.root();
    const email = app.email("verified");
    const created = await step("POST /admin/users as root with metadata", () =>
      root.api.post("/admin/users", {
        email: email.toUpperCase(),
        password: PASSWORD,
        displayName: "Vera Fied",
        emailVerified: true,
        publicMetadata: { plan: "pro", seats: 3 },
        privateMetadata: { crm: { id: "c_1" } },
      }),
    );
    await step("The email is lowercased and the metadata kept", async () => {
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        email,
        emailVerified: true,
        publicMetadata: { plan: "pro", seats: 3 },
        privateMetadata: { crm: { id: "c_1" } },
        userMetadata: {},
      });
    });
    await step("The new user signs in", async () => {
      const api = await app.newApi("verified");
      const signedIn = await api.signIn("/auth/login", email, PASSWORD);
      expect(signedIn.status).toBe(200);
      expect(signedIn.data.user!.id).toBe(created.data.id);
    });
    await step("The audit log names root as the actor", async () => {
      const events = await eventsOf(root.api, "user.created");
      const event = events.find((e) => e.resourceId === created.data.id);
      expect(event).toMatchObject({
        actorType: "root",
        actorId: root.id,
        actorLabel: root.email,
      });
    });
  },
);

test(
  "a user created without a password signs in with an emailed code",
  {
    tag: ["@users", "@auth"],
    annotation: about(
      "Leaving out the password makes an account that has none. It cannot sign in with a password, and an emailed login code works.",
    ),
  },
  async () => {
    const email = app.email("codes");
    const created = await step("POST /admin/users without a password", () =>
      app.service.post("/admin/users", { email, emailVerified: true }),
    );
    await step("hasPassword is false", async () => {
      expect(created.status).toBe(201);
      expect(created.data.hasPassword).toBe(false);
    });
    await step("An empty password string counts as no password", async () => {
      const other = await app.service.post("/admin/users", {
        email: app.email("empty"),
        password: "",
        emailVerified: true,
      });
      expect(other.status).toBe(201);
      expect(other.data.hasPassword).toBe(false);
    });
    await step("Password sign-in is refused", async () => {
      const api = await app.newApi("codes");
      const refused = await api.signIn("/auth/login", email, PASSWORD);
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("A login code signs them in", async () => {
      const api = await app.newApi("codes");
      const sent = await api.post("/auth/verification/send", {
        email,
        purpose: "login",
      });
      expect(sent.status).toBe(200);
      const confirmed = await api.post("/auth/verification/confirm", {
        email,
        purpose: "login",
        code: await app.mail.code(email),
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.data.user.email).toBe(email);
    });
  },
);

test(
  "creating a user refuses a taken or invalid email",
  {
    tag: "@users",
    annotation: about(
      "A second account with the same email, in any letter case, answers 409 EMAIL_TAKEN. A malformed email answers 422 EMAIL_INVALID.",
    ),
  },
  async () => {
    const user = await app.user("taken");
    await step("POST /admin/users with an email in use", async () => {
      const taken = await app.service.post("/admin/users", {
        email: user.email,
      });
      expect(taken.status).toBe(409);
      expect(taken.code).toBe("EMAIL_TAKEN");
    });
    await step("The same email in capitals is also taken", async () => {
      const taken = await app.service.post("/admin/users", {
        email: user.email.toUpperCase(),
      });
      expect(taken.code).toBe("EMAIL_TAKEN");
    });
    await step("Malformed emails answer 422 EMAIL_INVALID", async () => {
      for (const email of ["not-an-email", "a@", "", "two words@dopbase.com"]) {
        const invalid = await app.service.post("/admin/users", { email });
        expect(invalid.status, email).toBe(422);
        expect(invalid.code, email).toBe("EMAIL_INVALID");
      }
    });
    await step("A body with no email is a REQUEST_INVALID", async () => {
      const missing = await app.service.post("/admin/users", {
        password: PASSWORD,
      });
      expect(missing.code).toBe("REQUEST_INVALID");
    });
  },
);

test(
  "creating a user checks the password against the policy",
  {
    tag: ["@users", "@security"],
    annotation: about(
      "A password under the minimum length answers PASSWORD_INVALID. One on the leaked password list answers PASSWORD_LEAKED, until the leaked check is turned off.",
    ),
  },
  async () => {
    await step("A 7 character password is PASSWORD_INVALID", async () => {
      const short = await app.service.post("/admin/users", {
        email: app.email("short"),
        password: "abcdefg",
      });
      expect(short.status).toBe(422);
      expect(short.code).toBe("PASSWORD_INVALID");
    });
    await step("A password over 1024 bytes is PASSWORD_INVALID", async () => {
      const long = await app.service.post("/admin/users", {
        email: app.email("long"),
        password: "a".repeat(1025),
      });
      expect(long.status).toBe(422);
      expect(long.code).toBe("PASSWORD_INVALID");
    });
    await step("A leaked password is PASSWORD_LEAKED", async () => {
      const leaked = await app.service.post("/admin/users", {
        email: app.email("leaked"),
        password: LEAKED_PASSWORD,
      });
      expect(leaked.status).toBe(422);
      expect(leaked.code).toBe("PASSWORD_LEAKED");
    });
    await step("With the leaked check off, the same password is accepted", async () => {
      await app.settings("password", { rejectLeaked: false });
      try {
        const created = await app.service.post("/admin/users", {
          email: app.email("allowed"),
          password: LEAKED_PASSWORD,
        });
        expect(created.status).toBe(201);
      } finally {
        await app.settings("password", { rejectLeaked: true });
      }
    });
  },
);

test(
  "creating a user refuses a bad profile or bad metadata",
  {
    tag: "@users",
    annotation: about(
      "A display name with a line break or over 255 characters is PROFILE_INVALID. Metadata must be a JSON object, up to 1 KB for public and 16 KB for private.",
    ),
  },
  async () => {
    const create = (body: Record<string, unknown>) =>
      app.service.post("/admin/users", { email: app.email("bad"), ...body });
    await step("A display name with a line break is PROFILE_INVALID", async () => {
      const refused = await create({ displayName: "Two\nLines" });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("PROFILE_INVALID");
    });
    await step("A display name of 256 characters is PROFILE_INVALID", async () => {
      expect((await create({ displayName: "n".repeat(256) })).code).toBe(
        "PROFILE_INVALID",
      );
      expect((await create({ displayName: "n".repeat(255) })).status).toBe(201);
    });
    await step("Metadata that isn't an object is METADATA_INVALID", async () => {
      for (const publicMetadata of ["text", 5, [1, 2]]) {
        const refused = await create({ publicMetadata });
        expect(refused.status).toBe(422);
        expect(refused.code).toBe("METADATA_INVALID");
      }
      expect((await create({ privateMetadata: ["a"] })).code).toBe(
        "METADATA_INVALID",
      );
    });
    await step("publicMetadata over 1 KB is METADATA_INVALID", async () => {
      const refused = await create({ publicMetadata: metadataOfSize(1100) });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("METADATA_INVALID");
      const fine = await create({ publicMetadata: metadataOfSize(900) });
      expect(fine.status).toBe(201);
    });
    await step("privateMetadata takes 16 KB but not more", async () => {
      const refused = await create({ privateMetadata: metadataOfSize(17_000) });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("METADATA_INVALID");
      const fine = await create({ privateMetadata: metadataOfSize(15_000) });
      expect(fine.status).toBe(201);
    });
  },
);

test(
  "the admin view shows private metadata and the lock that /auth/me hides",
  {
    tag: ["@users", "@security"],
    annotation: about(
      "Admins and the service key read privateMetadata and lockedUntil. The user's own /auth/me returns neither, and wrong passwords set lockedUntil.",
    ),
  },
  async () => {
    const user = await app.user("seen", {
      publicMetadata: { plan: "pro" },
      privateMetadata: { risk: "low" },
      displayName: "Seen User",
    });
    const admin = await step("GET /admin/users/{id} as a backend", () =>
      app.service.get(`/admin/users/${user.id}`),
    );
    await step("It answers 200 USER_FETCHED with every field", async () => {
      expect(admin.status).toBe(200);
      expect(admin.message).toBe("USER_FETCHED");
      for (const field of USER_FIELDS) expect(admin.data).toHaveProperty(field);
      expect(admin.data).toMatchObject({
        privateMetadata: { risk: "low" },
        publicMetadata: { plan: "pro" },
        lockedUntil: null,
        emailVerified: true,
        displayName: "Seen User",
      });
    });
    await step("GET /auth/me has the same user without the admin fields", async () => {
      const me = await user.api.get("/auth/me");
      expect(me.status).toBe(200);
      expect(me.data).not.toHaveProperty("privateMetadata");
      expect(me.data).not.toHaveProperty("lockedUntil");
      expect(me.data.publicMetadata).toEqual({ plan: "pro" });
    });
    await step("Five wrong passwords lock the account", async () => {
      const api = await app.newApi("locker");
      for (let attempt = 0; attempt < 5; attempt++) {
        const wrong = await api.signIn("/auth/login", user.email, "wrong password");
        expect(wrong.code).toBe("AUTHENTICATION_INVALID");
      }
      const locked = await app.service.get(`/admin/users/${user.id}`);
      expect(locked.data.lockedUntil).toEqual(expect.any(String));
      expect(new Date(locked.data.lockedUntil).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  },
);

test(
  "an unknown id is 404, and an admin id is not a user",
  {
    tag: ["@users", "@admins"],
    annotation: about(
      "Every route that takes a user id answers 404 NOT_FOUND for an id that doesn't exist, including an adm_ id. Admins never show up in the users list.",
    ),
  },
  async () => {
    const root = await app.root();
    const unknown = "usr_00000000000000000000000000";
    await step("Each route answers 404 NOT_FOUND for an unknown user", async () => {
      const calls: [string, string, unknown?][] = [
        ["GET", `/admin/users/${unknown}`],
        ["PATCH", `/admin/users/${unknown}`, { displayName: "x" }],
        ["DELETE", `/admin/users/${unknown}`],
        ["POST", `/admin/users/${unknown}/disable`],
        ["POST", `/admin/users/${unknown}/enable`],
        ["POST", `/admin/users/${unknown}/password-reset`],
        ["GET", `/admin/users/${unknown}/sessions`],
        ["DELETE", `/admin/users/${unknown}/sessions`],
      ];
      for (const [method, path, body] of calls) {
        const result = await app.service.send(method, path, body);
        expect(result.status, `${method} ${path}`).toBe(404);
        expect(result.code, `${method} ${path}`).toBe("NOT_FOUND");
      }
    });
    await step("An adm_ id is 404 here", async () => {
      const fetched = await app.service.get(`/admin/users/${root.id}`);
      expect(fetched.status).toBe(404);
      expect(fetched.code).toBe("NOT_FOUND");
      const disabled = await app.service.post(`/admin/users/${root.id}/disable`);
      expect(disabled.status).toBe(404);
    });
    await step("The root account is not in the users list", async () => {
      const list = await app.service.get(
        `/admin/users?email=${encodeURIComponent(root.email)}`,
      );
      expect(list.data.items).toEqual([]);
      const searched = await app.service.get(
        `/admin/users?search=${encodeURIComponent(root.email.split("@")[0]!)}`,
      );
      expect(searched.data.items.map((u: any) => u.id)).not.toContain(root.id);
    });
  },
);

test(
  "PATCH changes profile fields, and metadata is replaced whole",
  {
    tag: "@users",
    annotation: about(
      "An update leaves out fields untouched, replaces a metadata object entirely, clears displayName with an empty string, and can set emailVerified. The audit log lists the fields that changed.",
    ),
  },
  async () => {
    const user = await app.user("patched", {
      verified: false,
      password: true,
      signIn: false,
      displayName: "Before",
      publicMetadata: { a: 1, b: 2 },
      privateMetadata: { secret: true, keep: "me" },
    });
    await step("PATCH displayName, avatarUrl and emailVerified", async () => {
      const updated = await app.service.patch(`/admin/users/${user.id}`, {
        displayName: "After",
        avatarUrl: "https://example.com/a.png",
        emailVerified: true,
      });
      expect(updated.status).toBe(200);
      expect(updated.message).toBe("USER_UPDATED");
      expect(updated.data).toMatchObject({
        displayName: "After",
        avatarUrl: "https://example.com/a.png",
        emailVerified: true,
        publicMetadata: { a: 1, b: 2 },
        privateMetadata: { secret: true, keep: "me" },
      });
    });
    await step("A new publicMetadata replaces the old object whole", async () => {
      const updated = await app.service.patch(`/admin/users/${user.id}`, {
        publicMetadata: { c: 3 },
      });
      expect(updated.data.publicMetadata).toEqual({ c: 3 });
      expect(updated.data.privateMetadata).toEqual({
        secret: true,
        keep: "me",
      });
      expect(updated.data.displayName).toBe("After");
    });
    await step("A new privateMetadata replaces the old one, and {} empties it", async () => {
      const replaced = await app.service.patch(`/admin/users/${user.id}`, {
        privateMetadata: { only: 1 },
      });
      expect(replaced.data.privateMetadata).toEqual({ only: 1 });
      const emptied = await app.service.patch(`/admin/users/${user.id}`, {
        privateMetadata: {},
      });
      expect(emptied.data.privateMetadata).toEqual({});
    });
    await step("An empty displayName and avatarUrl clear them", async () => {
      const cleared = await app.service.patch(`/admin/users/${user.id}`, {
        displayName: "",
        avatarUrl: "",
      });
      expect(cleared.data.displayName).toBeNull();
      expect(cleared.data.avatarUrl).toBeNull();
    });
    await step("emailVerified can go back to false", async () => {
      const unverified = await app.service.patch(`/admin/users/${user.id}`, {
        emailVerified: false,
      });
      expect(unverified.data.emailVerified).toBe(false);
    });
    await step("An empty body changes nothing", async () => {
      const before = await app.service.get(`/admin/users/${user.id}`);
      const same = await app.service.patch(`/admin/users/${user.id}`, {});
      expect(same.status).toBe(200);
      expect(same.data.publicMetadata).toEqual(before.data.publicMetadata);
      expect(same.data.email).toBe(user.email);
    });
    await step("The audit log lists the fields of each update", async () => {
      const events = (await eventsOf(app.service, "user.updated")).filter(
        (event) => event.resourceId === user.id,
      );
      expect(events[events.length - 1].metadata.fields).toEqual([
        "displayName",
        "avatarUrl",
        "emailVerified",
      ]);
      expect(events.some((e) => e.metadata.fields.includes("publicMetadata"))).toBe(true);
      expect(events.some((e) => e.metadata.fields.includes("privateMetadata"))).toBe(true);
      expect(events[events.length - 1]).toMatchObject({
        actorType: "service",
        metadata: { fields: ["displayName", "avatarUrl", "emailVerified"] },
      });
    });
  },
);

test(
  "PATCH refuses a bad profile or bad metadata and keeps the account as it was",
  {
    tag: "@users",
    annotation: about(
      "PROFILE_INVALID and METADATA_INVALID answer 422, and nothing in the request is saved.",
    ),
  },
  async () => {
    const user = await app.user("refused", {
      displayName: "Stays",
      publicMetadata: { stays: true },
    });
    const patch = (body: Record<string, unknown>) =>
      app.service.patch(`/admin/users/${user.id}`, body);
    await step("A line break in displayName is PROFILE_INVALID", async () => {
      const refused = await patch({ displayName: "a\nb" });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("PROFILE_INVALID");
    });
    await step("An avatarUrl that isn't http(s) is PROFILE_INVALID", async () => {
      for (const avatarUrl of ["ftp://example.com/a.png", "javascript:alert(1)", "not a url"]) {
        expect((await patch({ avatarUrl })).code, avatarUrl).toBe("PROFILE_INVALID");
      }
      const tooLong = await patch({ avatarUrl: `https://example.com/${"a".repeat(2100)}` });
      expect(tooLong.code).toBe("PROFILE_INVALID");
    });
    await step("An array is METADATA_INVALID", async () => {
      expect((await patch({ publicMetadata: [1] })).code).toBe("METADATA_INVALID");
      expect((await patch({ privateMetadata: "x" })).code).toBe("METADATA_INVALID");
    });
    await step("Public metadata over 1 KB and private over 16 KB are refused", async () => {
      const publicOver = await patch({ publicMetadata: metadataOfSize(1100) });
      expect(publicOver.status).toBe(422);
      expect(publicOver.code).toBe("METADATA_INVALID");
      const privateOver = await patch({ privateMetadata: metadataOfSize(17_000) });
      expect(privateOver.code).toBe("METADATA_INVALID");
    });
    await step("A refused request changed nothing", async () => {
      const current = await app.service.get(`/admin/users/${user.id}`);
      expect(current.data).toMatchObject({
        displayName: "Stays",
        publicMetadata: { stays: true },
        avatarUrl: null,
      });
    });
  },
);

test(
  "publicMetadata is the public_metadata claim on the next token",
  {
    tag: ["@users", "@tokens"],
    annotation: about(
      "An admin sets publicMetadata. The user's current token doesn't change, the next refreshed one carries public_metadata, and an emptied object drops the claim.",
    ),
  },
  async () => {
    const user = await app.user("claimed");
    await step("A token issued before has no claim", async () => {
      expect(claims(user.tokens!.accessToken)).not.toHaveProperty("public_metadata");
    });
    await step("PATCH publicMetadata as a backend", async () => {
      const updated = await app.service.patch(`/admin/users/${user.id}`, {
        publicMetadata: { role: "manager", teams: ["a", "b"] },
      });
      expect(updated.status).toBe(200);
    });
    const refreshed = await step("POST /auth/refresh", () =>
      user.api.post("/auth/refresh", { refreshToken: user.tokens!.refreshToken }),
    );
    await step("The new access token carries public_metadata", async () => {
      expect(refreshed.status).toBe(200);
      expect(claims(refreshed.data.accessToken).public_metadata).toEqual({
        role: "manager",
        teams: ["a", "b"],
      });
      expect(claims(user.tokens!.accessToken)).not.toHaveProperty("public_metadata");
    });
    await step("An emptied object removes the claim from the next token", async () => {
      await app.service.patch(`/admin/users/${user.id}`, { publicMetadata: {} });
      const again = await user.api.post("/auth/refresh", {
        refreshToken: refreshed.data.refreshToken,
      });
      expect(again.status).toBe(200);
      expect(claims(again.data.accessToken)).not.toHaveProperty("public_metadata");
    });
  },
);

test(
  "disabling a user ends their sessions and refuses sign-in until enabled",
  {
    tag: ["@users", "@auth"],
    annotation: about(
      "An admin disables an account. Its sessions end, its tokens stop working, sign-in answers ACCOUNT_DISABLED, and enabling restores sign-in.",
    ),
  },
  async () => {
    const user = await app.user("disabled");
    const second = await app.userSession(user.email);
    const disabled = await step("POST /admin/users/{id}/disable", () =>
      app.service.post(`/admin/users/${user.id}/disable`),
    );
    await step("It answers 200 USER_DISABLED with status disabled", async () => {
      expect(disabled.status).toBe(200);
      expect(disabled.message).toBe("USER_DISABLED");
      expect(disabled.data).toMatchObject({ id: user.id, status: "disabled" });
    });
    await step("Both sessions are gone from the list", async () => {
      const sessions = await app.service.get(`/admin/users/${user.id}/sessions`);
      expect(sessions.data).toEqual([]);
    });
    await step("Their access tokens and refresh tokens are refused", async () => {
      for (const api of [user.api, second.api]) {
        const me = await api.get("/auth/me");
        expect(me.status).toBe(401);
        expect(me.code).toBe("TOKEN_INVALID");
      }
      const refresh = await user.api.post("/auth/refresh", {
        refreshToken: user.tokens!.refreshToken,
      });
      expect(refresh.status).toBe(401);
      expect(refresh.code).toBe("TOKEN_INVALID");
    });
    await step("Sign-in answers 403 ACCOUNT_DISABLED", async () => {
      const api = await app.newApi("blocked");
      const refused = await api.signIn("/auth/login", user.email, PASSWORD);
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("ACCOUNT_DISABLED");
    });
    await step("The audit log records user.disabled with the sessions ended", async () => {
      const event = (await eventsOf(app.service, "user.disabled")).find(
        (e) => e.resourceId === user.id,
      );
      expect(event.metadata.sessionsEnded).toBe(2);
    });
    await step("POST /admin/users/{id}/enable lets them in again", async () => {
      const enabled = await app.service.post(`/admin/users/${user.id}/enable`);
      expect(enabled.status).toBe(200);
      expect(enabled.message).toBe("USER_ENABLED");
      expect(enabled.data.status).toBe("active");
      const api = await app.newApi("back");
      const signedIn = await api.signIn("/auth/login", user.email, PASSWORD);
      expect(signedIn.status).toBe(200);
    });
    await step("The old sessions stay ended", async () => {
      expect((await user.api.get("/auth/me")).ok).toBe(false);
    });
    await step("The audit log records user.enabled", async () => {
      const event = (await eventsOf(app.service, "user.enabled")).find(
        (e) => e.resourceId === user.id,
      );
      expect(event.metadata.sessionsEnded).toBe(0);
    });
  },
);

test(
  "deleting a user removes the account and its sessions",
  {
    tag: ["@users", "@audit"],
    annotation: about(
      "DELETE answers 204 with no body. The user can't be fetched, their token no longer works, their password no longer signs in, and the email can sign up again as a new account.",
    ),
  },
  async () => {
    const user = await app.user("deleted");
    const deleted = await step("DELETE /admin/users/{id}", () =>
      app.service.delete(`/admin/users/${user.id}`),
    );
    await step("It answers 204 with no body", async () => {
      expect(deleted.status).toBe(204);
      expect(deleted.body).toBeFalsy();
    });
    await step("GET /admin/users/{id} is 404", async () => {
      expect((await app.service.get(`/admin/users/${user.id}`)).code).toBe("NOT_FOUND");
    });
    await step("Their access token is refused", async () => {
      const me = await user.api.get("/auth/me");
      expect(me.status).toBe(401);
      expect(me.code).toBe("TOKEN_INVALID");
    });
    await step("Their refresh token is refused", async () => {
      const refresh = await user.api.post("/auth/refresh", {
        refreshToken: user.tokens!.refreshToken,
      });
      expect(refresh.status).toBe(401);
      expect(refresh.code).toBe("TOKEN_INVALID");
    });
    await step("Their password no longer signs in", async () => {
      const api = await app.newApi("gone");
      const refused = await api.signIn("/auth/login", user.email, PASSWORD);
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("A second DELETE is 404", async () => {
      const again = await app.service.delete(`/admin/users/${user.id}`);
      expect(again.status).toBe(404);
      expect(again.code).toBe("NOT_FOUND");
    });
    await step("The audit log keeps user.deleted with the email", async () => {
      const event = (await eventsOf(app.service, "user.deleted")).find(
        (e) => e.resourceId === user.id,
      );
      expect(event).toMatchObject({
        actorType: "service",
        metadata: { email: user.email },
      });
    });
    await step("The email can be used by a new account", async () => {
      const again = await app.service.post("/admin/users", {
        email: user.email,
        password: PASSWORD,
      });
      expect(again.status).toBe(201);
      expect(again.data.id).not.toBe(user.id);
    });
  },
);

test(
  "a password reset from the admin API emails a code that resets the password",
  {
    tag: ["@users", "@auth"],
    annotation: about(
      "An admin sends a password_reset code. The user enters it at /auth/password/reset, signs in with the new password, and the old sessions and password stop working.",
    ),
  },
  async () => {
    const user = await app.user("reset");
    const sent = await step("POST /admin/users/{id}/password-reset", () =>
      app.service.post(`/admin/users/${user.id}/password-reset`),
    );
    await step("It answers 200 PASSWORD_RESET_SENT", async () => {
      expect(sent.status).toBe(200);
      expect(sent.message).toBe("PASSWORD_RESET_SENT");
    });
    const mail = await step("The email carries a 6-digit code", async () => {
      const mail = await app.mail.last(user.email);
      expect(mail.subject).toBe("Reset your Dopgate password");
      expect(await app.mail.code(user.email)).toMatch(/^\d{6}$/);
      return mail;
    });
    const newPassword = app.value();
    await step("POST /auth/password/reset with that code", async () => {
      const api = await app.newApi("resetter");
      const reset = await api.post("/auth/password/reset", {
        email: user.email,
        code: await app.mail.code(user.email),
        newPassword,
      });
      expect(reset.status, mail.text).toBe(200);
    });
    await step("The new password signs in and the old one doesn't", async () => {
      const api = await app.newApi("after");
      expect((await api.signIn("/auth/login", user.email, newPassword)).status).toBe(200);
      const old = await api.signIn("/auth/login", user.email, PASSWORD);
      expect(old.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("The old session ended", async () => {
      expect((await user.api.get("/auth/me")).ok).toBe(false);
    });
    await step("The audit log has user.password_reset_sent and user.password_reset", async () => {
      const sentEvents = await eventsOf(app.service, "user.password_reset_sent");
      expect(sentEvents.some((e) => e.resourceId === user.id && e.actorType === "service")).toBe(true);
      const doneEvents = await eventsOf(app.service, "user.password_reset");
      expect(doneEvents.some((e) => e.actorLabel === user.email)).toBe(true);
    });
  },
);

test(
  "a code that isn't the latest reset code is refused after a second send",
  {
    tag: ["@users", "@auth"],
    annotation: about(
      "Sending a second reset replaces the first code, so only the newest one works.",
    ),
  },
  async () => {
    const user = await app.user("twice");
    await step("POST password-reset twice", async () => {
      expect((await app.service.post(`/admin/users/${user.id}/password-reset`)).status).toBe(200);
      await app.mail.last(user.email);
      const first = await app.mail.code(user.email);
      expect((await app.service.post(`/admin/users/${user.id}/password-reset`)).status).toBe(200);
      const latest = await app.mail.code(user.email, { after: 1 });
      const api = await app.newApi("twice");
      if (first !== latest) {
        const stale = await api.post("/auth/password/reset", {
          email: user.email,
          code: first,
          newPassword: app.value(),
        });
        expect(stale.code).toBe("CODE_INVALID");
      }
      const fresh = await api.post("/auth/password/reset", {
        email: user.email,
        code: latest,
        newPassword: app.value(),
      });
      expect(fresh.status).toBe(200);
    });
  },
);

test(
  "an admin lists a user's sessions and signs them out everywhere",
  {
    tag: ["@users", "@auth"],
    annotation: about(
      "The session list shows each sign-in with its method, address and browser, and never marks one as current. DELETE ends all of them and the user's tokens stop working.",
    ),
  },
  async () => {
    const user = await app.user("sessions");
    const other = await app.userSession(user.email, PASSWORD, "second");
    const listed = await step("GET /admin/users/{id}/sessions", () =>
      app.service.get(`/admin/users/${user.id}/sessions`),
    );
    await step("It lists both sessions, none of them current", async () => {
      expect(listed.status).toBe(200);
      expect(listed.message).toBe("SESSIONS_FETCHED");
      expect(listed.data).toHaveLength(2);
      for (const session of listed.data) {
        expect(session).toMatchObject({
          method: "password",
          current: false,
          ipAddress: "127.0.0.1",
        });
        expect(session.id).toMatch(/^ses_/);
        expect(session.userAgent).toEqual(expect.any(String));
        for (const time of ["createdAt", "lastUsedAt", "expiresAt"]) {
          expect(Date.parse(session[time])).not.toBeNaN();
        }
      }
      const ids = listed.data.map((session: any) => session.id);
      expect(ids).toContain(claims(user.tokens!.accessToken).sid);
      expect(ids).toContain(claims(other.tokens.accessToken).sid);
    });
    await step("An admin from the console sees the same list", async () => {
      const root = await app.root();
      const asRoot = await root.api.get(`/admin/users/${user.id}/sessions`);
      expect(asRoot.data).toHaveLength(2);
      expect(asRoot.data.every((s: any) => s.current === false)).toBe(true);
    });
    const revoked = await step("DELETE /admin/users/{id}/sessions", () =>
      app.service.delete(`/admin/users/${user.id}/sessions`),
    );
    await step("It answers 200 SESSIONS_REVOKED", async () => {
      expect(revoked.status).toBe(200);
      expect(revoked.message).toBe("SESSIONS_REVOKED");
    });
    await step("The list is empty and both users' tokens are refused", async () => {
      const after = await app.service.get(`/admin/users/${user.id}/sessions`);
      expect(after.data).toEqual([]);
      for (const api of [user.api, other.api]) {
        const me = await api.get("/auth/me");
        expect(me.status).toBe(401);
        expect(me.code).toBe("TOKEN_INVALID");
      }
      const refresh = await other.api.post("/auth/refresh", {
        refreshToken: other.tokens.refreshToken,
      });
      expect(refresh.code).toBe("TOKEN_INVALID");
    });
    await step("The account itself still signs in, and the audit log has the count", async () => {
      const api = await app.newApi("again");
      expect((await api.signIn("/auth/login", user.email, PASSWORD)).status).toBe(200);
      const event = (await eventsOf(app.service, "user.sessions_revoked")).find(
        (e) => e.resourceId === user.id,
      );
      expect(event.metadata.sessionsEnded).toBe(2);
    });
    await step("Ending the sessions of a user with none still answers 200", async () => {
      const empty = await app.user("nosessions", { signIn: false });
      const result = await app.service.delete(`/admin/users/${empty.id}/sessions`);
      expect(result.status).toBe(200);
    });
  },
);

test(
  "only admins and the service key may use the users routes",
  {
    tag: ["@users", "@security"],
    annotation: about(
      "Without a token every users route answers 401. A user's own access token answers 403 AUTHORIZATION_DENIED. An admin who isn't root can use them.",
    ),
  },
  async () => {
    const user = await app.user("snoop");
    const target = await app.user("target");
    const routes: [string, string, unknown?][] = [
      ["GET", "/admin/users"],
      ["POST", "/admin/users", { email: app.email("never") }],
      ["GET", `/admin/users/${target.id}`],
      ["PATCH", `/admin/users/${target.id}`, { displayName: "x" }],
      ["DELETE", `/admin/users/${target.id}`],
      ["POST", `/admin/users/${target.id}/disable`],
      ["POST", `/admin/users/${target.id}/enable`],
      ["POST", `/admin/users/${target.id}/password-reset`],
      ["GET", `/admin/users/${target.id}/sessions`],
      ["DELETE", `/admin/users/${target.id}/sessions`],
    ];
    await step("With no token each route answers 401 AUTHENTICATION_REQUIRED", async () => {
      for (const [method, path, body] of routes) {
        const result = await app.api.send(method, path, body);
        expect(result.status, `${method} ${path}`).toBe(401);
        expect(result.code, `${method} ${path}`).toBe("AUTHENTICATION_REQUIRED");
      }
    });
    await step("With a user's token each route answers 403 AUTHORIZATION_DENIED", async () => {
      for (const [method, path, body] of routes) {
        const result = await user.api.send(method, path, body);
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.code, `${method} ${path}`).toBe("AUTHORIZATION_DENIED");
      }
    });
    await step("A wrong service key is AUTHENTICATION_INVALID", async () => {
      const wrong = await app.api.get("/admin/users", { token: "e2e_wrong_key_".padEnd(40, "x") });
      expect(wrong.status).toBe(401);
      expect(wrong.code).toBe("AUTHENTICATION_INVALID");
    });
    await step("The target was never touched", async () => {
      const still = await app.service.get(`/admin/users/${target.id}`);
      expect(still.data.status).toBe("active");
    });
    await step("An admin who isn't root can read and change users", async () => {
      const sam = await app.admin("sam");
      expect((await sam.api.get("/admin/users")).status).toBe(200);
      const updated = await sam.api.patch(`/admin/users/${target.id}`, { displayName: "By Sam" });
      expect(updated.status).toBe(200);
      const event = (await eventsOf(sam.api, "user.updated")).find((e) => e.resourceId === target.id);
      expect(event).toMatchObject({ actorType: "admin", actorLabel: sam.email });
    });
  },
);
