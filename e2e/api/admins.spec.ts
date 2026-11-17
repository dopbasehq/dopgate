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
  audit,
  auditEvent,
  expectError,
  PASSWORD,
  ROOT_EMAIL,
  type AdminRecord,
} from "./console.support.ts";

const app = useServer();

test(
  "root adds an admin with a password",
  {
    tag: ["@admins"],
    annotation: about(
      "POST /admin/admins makes an admin account without sending any email. The answer is the admin with an adm_ id and the admin role, the new admin signs in with the password, and the audit log names root as the actor.",
    ),
  },
  async () => {
    const root = await app.root();
    const email = app.email("ana");
    const created = await step("POST /admin/admins with an email, a password and a name", () =>
      root.api.post("/admin/admins", {
        email,
        password: PASSWORD,
        displayName: "Ana",
      }),
    );
    await step("It answers 201 ADMIN_CREATED with the admin", async () => {
      expect(created.status).toBe(201);
      expect(created.message).toBe("ADMIN_CREATED");
      expect(created.data).toMatchObject({
        email,
        displayName: "Ana",
        avatarUrl: null,
        role: "admin",
        status: "active",
        hasPassword: true,
        lockedUntil: null,
        lastSignInAt: null,
      });
      expect(created.data.id).toMatch(/^adm_/);
      expect(created.data).not.toHaveProperty("password");
    });
    await step("No email was sent", async () => {
      await new Promise((wait) => setTimeout(wait, 300));
      expect(await app.mail.count(email)).toBe(0);
    });
    await step("The new admin signs in to the console with the password", async () => {
      const login = await app.api.post("/console/login", { email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.data.admin.id).toBe(created.data.id);
      expect(login.data.admin.role).toBe("admin");
      expect(claims(login.data.accessToken).role).toBe("admin");
    });
    await step("The creation is audited as admin.created by root", async () => {
      const event = await auditEvent(
        app,
        "admin.created",
        (e) => e.resourceId === created.data.id,
      );
      expect(event).toMatchObject({
        actorType: "root",
        actorLabel: ROOT_EMAIL,
        resourceType: "admin",
        metadata: { email },
      });
    });
  },
);

test(
  "root adds an admin without a password, who then signs in by code",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "Leaving the password out makes an admin who signs in with emailed codes only. Their account says hasPassword false, and an empty password counts as none.",
    ),
  },
  async () => {
    const root = await app.root();
    const bare = app.email("bare");
    const empty = app.email("empty");
    await step("POST /admin/admins without a password", async () => {
      const created = await root.api.post("/admin/admins", { email: bare });
      expect(created.status).toBe(201);
      expect(created.data.hasPassword).toBe(false);
      expect(created.data.displayName).toBeNull();
    });
    await step("POST /admin/admins with an empty password", async () => {
      const created = await root.api.post("/admin/admins", {
        email: empty,
        password: "",
      });
      expect(created.status).toBe(201);
      expect(created.data.hasPassword).toBe(false);
    });
    await step("A password sign-in is refused", async () => {
      const login = await app.api.post("/console/login", {
        email: bare,
        password: PASSWORD,
      });
      expectError(login, 401, "AUTHENTICATION_INVALID");
    });
    await step("A code sign-in works", async () => {
      await app.api.post("/console/codes/send", { email: bare });
      const code = await app.mail.code(bare);
      const confirmed = await app.api.post("/console/codes/confirm", {
        email: bare,
        purpose: "login",
        code,
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.data.admin.email).toBe(bare);
    });
  },
);

test(
  "admin emails are unique among admins, but a user may share one",
  {
    tag: ["@admins", "@users"],
    annotation: about(
      "A second admin with the same email, in any letter case, is a 409 EMAIL_TAKEN, and so is root's email. A user of the app with that email doesn't count, so an admin can share an address with a user.",
    ),
  },
  async () => {
    const root = await app.root();
    const first = await addAdmin(app, { name: "dup" });
    await step("POST /admin/admins with an email another admin uses", async () => {
      expectError(
        await root.api.post("/admin/admins", { email: first.email }),
        409,
        "EMAIL_TAKEN",
      );
    });
    await step("POST /admin/admins with the same email in capitals", async () => {
      expectError(
        await root.api.post("/admin/admins", { email: first.email.toUpperCase() }),
        409,
        "EMAIL_TAKEN",
      );
    });
    await step("POST /admin/admins with root's email", async () => {
      expectError(
        await root.api.post("/admin/admins", { email: ROOT_EMAIL }),
        409,
        "EMAIL_TAKEN",
      );
    });
    await step("POST /admin/admins with the email of a user of the app", async () => {
      const user = await app.user("shared");
      const created = await root.api.post("/admin/admins", {
        email: user.email,
        password: PASSWORD,
      });
      expect(created.status).toBe(201);
      expect(created.data.id).not.toBe(user.id);
      const asAdmin = await app.api.post("/console/login", {
        email: user.email,
        password: PASSWORD,
      });
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.data.admin.id).toBe(created.data.id);
    });
    await step("The email is lowercased when stored", async () => {
      const mixed = app.email("MiXed");
      const created = await root.api.post("/admin/admins", { email: mixed });
      expect(created.status).toBe(201);
      expect(created.data.email).toBe(mixed.toLowerCase());
    });
  },
);

test(
  "creating an admin refuses an invalid email, a weak password and a leaked one",
  {
    tag: ["@admins", "@security"],
    annotation: about(
      "Each bad value gets its documented code and no account is made. The leaked password check uses the same list as sign-up, and turning it off in settings lets the password through.",
    ),
  },
  async () => {
    const root = await app.root();
    const email = app.email("val");
    await step("POST /admin/admins with an email that is not one", async () => {
      expectError(
        await root.api.post("/admin/admins", { email: "not-an-email" }),
        422,
        "EMAIL_INVALID",
      );
    });
    await step("POST /admin/admins without an email", async () => {
      const result = await root.api.post("/admin/admins", {});
      expect(result.status).toBe(422);
      expect(result.code).toBe("REQUEST_INVALID");
    });
    await step("POST /admin/admins with a password under the minimum length", async () => {
      expectError(
        await root.api.post("/admin/admins", { email, password: "short" }),
        422,
        "PASSWORD_INVALID",
      );
    });
    await step("POST /admin/admins with a password over 1024 bytes", async () => {
      expectError(
        await root.api.post("/admin/admins", {
          email,
          password: "p".repeat(1025),
        }),
        422,
        "PASSWORD_INVALID",
      );
    });
    await step("POST /admin/admins with a leaked password", async () => {
      expectError(
        await root.api.post("/admin/admins", { email, password: LEAKED_PASSWORD }),
        422,
        "PASSWORD_LEAKED",
      );
    });
    await step("POST /admin/admins with a display name that has a line break", async () => {
      expectError(
        await root.api.post("/admin/admins", { email, displayName: "a\nb" }),
        422,
        "PROFILE_INVALID",
      );
    });
    await step("None of those made an account", async () => {
      const list = await root.api.get("/admin/admins");
      expect(list.data.items.map((a: AdminRecord) => a.email)).not.toContain(email);
    });
    await step("With leaked password checks off the same password is accepted", async () => {
      await app.settings("password", { rejectLeaked: false });
      try {
        const created = await root.api.post("/admin/admins", {
          email,
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
  "GET /admin/admins lists root first and GET /admin/admins/{id} reads one",
  {
    tag: ["@admins"],
    annotation: about(
      "The list has every admin, root first, in a single page with no cursor. Reading one admin by id returns the same record, and an unknown or malformed id is a 404.",
    ),
  },
  async () => {
    const root = await app.root();
    const one = await addAdmin(app, { name: "ls-a", password: false });
    const two = await addAdmin(app, { name: "ls-b" });
    const list = await step("GET /admin/admins as root", () =>
      root.api.get("/admin/admins"),
    );
    await step("It answers ADMINS_FETCHED with root first", async () => {
      expect(list.status).toBe(200);
      expect(list.message).toBe("ADMINS_FETCHED");
      const items: AdminRecord[] = list.data.items;
      expect(items[0]).toMatchObject({ email: ROOT_EMAIL, role: "root" });
      expect(items.filter((a) => a.role === "root")).toHaveLength(1);
      const emails = items.map((a) => a.email);
      expect(emails).toContain(one.email);
      expect(emails).toContain(two.email);
      expect(list.data).not.toHaveProperty("nextCursor");
    });
    await step("GET /admin/admins/{id} returns that admin", async () => {
      const found = await root.api.get(`/admin/admins/${one.id}`);
      expect(found.status).toBe(200);
      expect(found.message).toBe("ADMIN_FETCHED");
      expect(found.data).toMatchObject({
        id: one.id,
        email: one.email,
        role: "admin",
        hasPassword: false,
      });
      const fromList = list.data.items.find((a: AdminRecord) => a.id === one.id);
      expect(found.data).toEqual(fromList);
    });
    await step("GET /admin/admins/{id} for root", async () => {
      const found = await root.api.get(`/admin/admins/${root.id}`);
      expect(found.data).toMatchObject({ role: "root", email: ROOT_EMAIL });
    });
    await step("GET /admin/admins/{id} with an unknown id", async () => {
      expectError(
        await root.api.get("/admin/admins/adm_00000000000000000000000000"),
        404,
        "NOT_FOUND",
      );
    });
    await step("GET /admin/admins/{id} with an id that is not an admin id", async () => {
      expectError(await root.api.get("/admin/admins/usr_whatever"), 404, "NOT_FOUND");
    });
  },
);

test(
  "an admin and the service key read the admins but may not change them",
  {
    tag: ["@admins", "@security"],
    annotation: about(
      "Admins and the backend's service key can list admins and read one. Every write answers 403 AUTHORIZATION_DENIED for them, and nothing changes. A user's token and a call with no token can't read either.",
    ),
  },
  async () => {
    const sam = await app.admin("sam");
    const target = await addAdmin(app, { name: "target" });
    const root = await app.root();
    const user = await app.user("ana");
    const callers = [
      ["an admin", sam.api],
      ["the service key", app.service],
    ] as const;
    for (const [name, api] of callers) {
      await step(`GET /admin/admins as ${name}`, async () => {
        const list = await api.get("/admin/admins");
        expect(list.status).toBe(200);
        expect(list.data.items[0].role).toBe("root");
      });
      await step(`GET /admin/admins/{id} as ${name}`, async () => {
        const found = await api.get(`/admin/admins/${target.id}`);
        expect(found.status).toBe(200);
        expect(found.data.email).toBe(target.email);
      });
      const writes: [string, () => Promise<any>][] = [
        ["POST /admin/admins", () => api.post("/admin/admins", { email: app.email("x") })],
        [
          "PATCH /admin/admins/{id}",
          () => api.patch(`/admin/admins/${target.id}`, { displayName: "Hacked" }),
        ],
        ["POST /admin/admins/{id}/disable", () => api.post(`/admin/admins/${target.id}/disable`)],
        ["POST /admin/admins/{id}/enable", () => api.post(`/admin/admins/${target.id}/enable`)],
        ["DELETE /admin/admins/{id}", () => api.delete(`/admin/admins/${target.id}`)],
      ];
      for (const [label, call] of writes) {
        await step(`${label} as ${name}`, async () => {
          expectError(await call(), 403, "AUTHORIZATION_DENIED");
        });
      }
    }
    await step("The target admin is unchanged and still active", async () => {
      const found = await root.api.get(`/admin/admins/${target.id}`);
      expect(found.data).toMatchObject({ displayName: null, status: "active" });
      const login = await app.api.post("/console/login", {
        email: target.email,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
    });
    await step("GET /admin/admins with a user's token", async () => {
      expectError(await user.api.get("/admin/admins"), 403, "AUTHORIZATION_DENIED");
    });
    await step("POST /admin/admins with a user's token", async () => {
      expectError(
        await user.api.post("/admin/admins", { email: app.email("x") }),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
    await step("GET /admin/admins with no token", async () => {
      expectError(await app.api.get("/admin/admins"), 401, "AUTHENTICATION_REQUIRED");
    });
  },
);

test(
  "root can't be changed through the admins API, not even by root",
  {
    tag: ["@admins", "@security"],
    annotation: about(
      "PATCH, disable, enable and DELETE on root's own id answer 403 ROOT_PROTECTED. Root stays active, keeps its email and keeps working. Reading root is fine.",
    ),
  },
  async () => {
    const root = await app.root();
    const changes: [string, () => Promise<any>][] = [
      ["PATCH /admin/admins/{root}", () => root.api.patch(`/admin/admins/${root.id}`, { displayName: "Boss" })],
      ["POST /admin/admins/{root}/disable", () => root.api.post(`/admin/admins/${root.id}/disable`)],
      ["POST /admin/admins/{root}/enable", () => root.api.post(`/admin/admins/${root.id}/enable`)],
      ["DELETE /admin/admins/{root}", () => root.api.delete(`/admin/admins/${root.id}`)],
    ];
    for (const [label, call] of changes) {
      await step(`${label} as root`, async () => {
        expectError(await call(), 403, "ROOT_PROTECTED");
      });
    }
    await step("Root is unchanged and its session still works", async () => {
      const me = await root.api.get("/console/me");
      expect(me.status).toBe(200);
      expect(me.data).toMatchObject({
        email: ROOT_EMAIL,
        role: "root",
        status: "active",
        displayName: null,
      });
    });
    await step("An admin who tries to change root is told they can't change admins at all", async () => {
      const sam = await app.admin("sam");
      expectError(
        await sam.api.post(`/admin/admins/${root.id}/disable`),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
    await step("No admin.disabled or admin.deleted event names root", async () => {
      for (const action of ["admin.disabled", "admin.deleted", "admin.updated"]) {
        const events = await audit(app, action);
        expect(events.filter((e) => e.resourceId === root.id)).toEqual([]);
      }
    });
  },
);

test(
  "PATCH /admin/admins/{id} changes the name and avatar",
  {
    tag: ["@admins"],
    annotation: about(
      "Root edits an admin's display name and avatar. A field left out stays, an empty string clears it, bad values are PROFILE_INVALID, and the audit event lists the fields that were sent.",
    ),
  },
  async () => {
    const root = await app.root();
    const admin = await addAdmin(app, { name: "edit", displayName: "Before" });
    await step("PATCH /admin/admins/{id} with a name and an avatar", async () => {
      const result = await root.api.patch(`/admin/admins/${admin.id}`, {
        displayName: "After",
        avatarUrl: "https://example.com/after.png",
      });
      expect(result.status).toBe(200);
      expect(result.message).toBe("ADMIN_UPDATED");
      expect(result.data).toMatchObject({
        id: admin.id,
        email: admin.email,
        displayName: "After",
        avatarUrl: "https://example.com/after.png",
        role: "admin",
      });
    });
    await step("PATCH /admin/admins/{id} with only a name keeps the avatar", async () => {
      const result = await root.api.patch(`/admin/admins/${admin.id}`, {
        displayName: "Again",
      });
      expect(result.data.displayName).toBe("Again");
      expect(result.data.avatarUrl).toBe("https://example.com/after.png");
    });
    await step("The admin sees the change in GET /console/me", async () => {
      const session = await app.consoleSession(admin.email);
      expect((await session.api.get("/console/me")).data.displayName).toBe("Again");
    });
    await step("PATCH /admin/admins/{id} with empty strings clears both", async () => {
      const result = await root.api.patch(`/admin/admins/${admin.id}`, {
        displayName: "",
        avatarUrl: "",
      });
      expect(result.data.displayName).toBeNull();
      expect(result.data.avatarUrl).toBeNull();
    });
    await step("PATCH /admin/admins/{id} with a bad name or avatar", async () => {
      expectError(
        await root.api.patch(`/admin/admins/${admin.id}`, { displayName: "a\nb" }),
        422,
        "PROFILE_INVALID",
      );
      expectError(
        await root.api.patch(`/admin/admins/${admin.id}`, { avatarUrl: "ftp://x" }),
        422,
        "PROFILE_INVALID",
      );
    });
    await step("PATCH /admin/admins/{id} can't change the email or role", async () => {
      const result = await root.api.patch(`/admin/admins/${admin.id}`, {
        email: app.email("other"),
        role: "root",
        displayName: "Kept",
      });
      expect(result.status).toBe(200);
      expect(result.data).toMatchObject({
        email: admin.email,
        role: "admin",
        displayName: "Kept",
      });
    });
    await step("The change is audited as admin.updated with its fields", async () => {
      const events = (await audit(app, "admin.updated")).filter(
        (e) => e.resourceId === admin.id,
      );
      expect(events.length).toBeGreaterThanOrEqual(3);
      const first = events[events.length - 1];
      expect(first).toMatchObject({ actorType: "root", actorLabel: ROOT_EMAIL });
      expect(first.metadata.fields).toEqual(
        expect.arrayContaining(["displayName", "avatarUrl"]),
      );
    });
  },
);

test(
  "disabling an admin ends their sessions and enabling lets them back in",
  {
    tag: ["@admins", "@console"],
    annotation: about(
      "Root disables an admin. Their open console sessions end at once, sign-in answers ACCOUNT_DISABLED, and the record says disabled. Enabling brings them back with a new sign-in, and both changes are audited.",
    ),
  },
  async () => {
    const root = await app.root();
    const sam = await app.admin("sam");
    const second = await app.consoleSession(sam.email);
    const disabled = await step("POST /admin/admins/{id}/disable", () =>
      root.api.post(`/admin/admins/${sam.id}/disable`),
    );
    await step("It answers ADMIN_DISABLED with the admin as disabled", async () => {
      expect(disabled.status).toBe(200);
      expect(disabled.message).toBe("ADMIN_DISABLED");
      expect(disabled.data).toMatchObject({ id: sam.id, status: "disabled" });
    });
    await step("Both of their sessions ended", async () => {
      expectError(await sam.api.get("/console/me"), 401, "TOKEN_INVALID");
      expectError(await second.api.get("/console/me"), 401, "TOKEN_INVALID");
      const refresh = await app.api.post("/console/refresh", {
        refreshToken: sam.tokens.refreshToken,
      });
      expectError(refresh, 401, "TOKEN_INVALID");
    });
    await step("Their token is no good on the admin API either", async () => {
      expectError(await sam.api.get("/admin/admins"), 401, "TOKEN_INVALID");
    });
    await step("POST /console/login answers ACCOUNT_DISABLED", async () => {
      const login = await app.api.post("/console/login", {
        email: sam.email,
        password: PASSWORD,
      });
      expectError(login, 403, "ACCOUNT_DISABLED");
    });
    await step("GET /admin/admins/{id} shows the status", async () => {
      expect((await root.api.get(`/admin/admins/${sam.id}`)).data.status).toBe("disabled");
    });
    await step("Disabling again still answers 200", async () => {
      expect((await root.api.post(`/admin/admins/${sam.id}/disable`)).status).toBe(200);
    });
    const enabled = await step("POST /admin/admins/{id}/enable", () =>
      root.api.post(`/admin/admins/${sam.id}/enable`),
    );
    await step("It answers ADMIN_ENABLED with the admin as active", async () => {
      expect(enabled.status).toBe(200);
      expect(enabled.message).toBe("ADMIN_ENABLED");
      expect(enabled.data).toMatchObject({ id: sam.id, status: "active" });
    });
    await step("The admin signs in again, the old session stays ended", async () => {
      const login = await app.api.post("/console/login", {
        email: sam.email,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
      expectError(await sam.api.get("/console/me"), 401, "TOKEN_INVALID");
    });
    await step("Both changes are audited with the sessions they ended", async () => {
      const off = await auditEvent(
        app,
        "admin.disabled",
        (e) => e.resourceId === sam.id && e.metadata.sessionsEnded === 2,
      );
      expect(off).toMatchObject({ actorType: "root", actorLabel: ROOT_EMAIL });
      const on = await auditEvent(
        app,
        "admin.enabled",
        (e) => e.resourceId === sam.id,
      );
      expect(on.metadata.sessionsEnded).toBe(0);
    });
  },
);

test(
  "DELETE /admin/admins/{id} removes the admin and their access",
  {
    tag: ["@admins"],
    annotation: about(
      "Root removes an admin. The answer is 204 with no body, the admin leaves the list and can't be read, their token stops working, signing in answers like a wrong password, and the audit log keeps the email.",
    ),
  },
  async () => {
    const root = await app.root();
    const sam = await app.admin("gone");
    const removed = await step("DELETE /admin/admins/{id}", () =>
      root.api.delete(`/admin/admins/${sam.id}`),
    );
    await step("It answers 204 with no body", async () => {
      expect(removed.status).toBe(204);
      expect(removed.body).toBeFalsy();
    });
    await step("The admin's token stops working", async () => {
      const me = await sam.api.get("/console/me");
      expect(me.status).toBe(401);
      const list = await sam.api.get("/admin/admins");
      expect(list.status).toBe(401);
      const refresh = await app.api.post("/console/refresh", {
        refreshToken: sam.tokens.refreshToken,
      });
      expectError(refresh, 401, "TOKEN_INVALID");
    });
    await step("Signing in answers like a wrong password", async () => {
      const login = await app.api.post("/console/login", {
        email: sam.email,
        password: PASSWORD,
      });
      expectError(login, 401, "AUTHENTICATION_INVALID");
    });
    await step("The admin is gone from the list and from GET", async () => {
      const list = await root.api.get("/admin/admins");
      expect(list.data.items.map((a: AdminRecord) => a.id)).not.toContain(sam.id);
      expectError(await root.api.get(`/admin/admins/${sam.id}`), 404, "NOT_FOUND");
    });
    await step("DELETE /admin/admins/{id} again", async () => {
      expectError(await root.api.delete(`/admin/admins/${sam.id}`), 404, "NOT_FOUND");
    });
    await step("The email can be used for a new admin", async () => {
      const again = await root.api.post("/admin/admins", { email: sam.email });
      expect(again.status).toBe(201);
      expect(again.data.id).not.toBe(sam.id);
    });
    await step("The removal is audited as admin.deleted with the email", async () => {
      const event = await auditEvent(
        app,
        "admin.deleted",
        (e) => e.resourceId === sam.id,
      );
      expect(event).toMatchObject({
        actorType: "root",
        resourceType: "admin",
        metadata: { email: sam.email },
      });
    });
  },
);

test(
  "an unknown admin id is a 404 on every route that takes one",
  {
    tag: ["@admins"],
    annotation: about(
      "Reading, changing, disabling, enabling and deleting an id that no admin has all answer 404 NOT_FOUND. For a caller who isn't root the permission check comes first, so they get 403.",
    ),
  },
  async () => {
    const root = await app.root();
    const missing = "adm_00000000000000000000000000";
    const calls: [string, () => Promise<any>][] = [
      ["GET /admin/admins/{id}", () => root.api.get(`/admin/admins/${missing}`)],
      ["PATCH /admin/admins/{id}", () => root.api.patch(`/admin/admins/${missing}`, { displayName: "X" })],
      ["POST /admin/admins/{id}/disable", () => root.api.post(`/admin/admins/${missing}/disable`)],
      ["POST /admin/admins/{id}/enable", () => root.api.post(`/admin/admins/${missing}/enable`)],
      ["DELETE /admin/admins/{id}", () => root.api.delete(`/admin/admins/${missing}`)],
    ];
    for (const [label, call] of calls) {
      await step(`${label} as root`, async () => {
        expectError(await call(), 404, "NOT_FOUND");
      });
    }
    await step("PATCH /admin/admins/{id} as an admin", async () => {
      const sam = await app.admin("sam");
      expectError(
        await sam.api.patch(`/admin/admins/${missing}`, { displayName: "X" }),
        403,
        "AUTHORIZATION_DENIED",
      );
    });
  },
);

test(
  "an admin added by root can use the admin API",
  {
    tag: ["@admins"],
    annotation: about(
      "An admin's console token opens the user, settings and audit endpoints. It also shows in the audit log as an admin, not root, when it acts.",
    ),
  },
  async () => {
    const sam = await app.admin("sam");
    await step("GET /admin/users as an admin", async () => {
      expect((await sam.api.get("/admin/users")).status).toBe(200);
    });
    await step("GET /admin/settings as an admin", async () => {
      expect((await sam.api.get("/admin/settings")).status).toBe(200);
    });
    await step("POST /admin/users as an admin leaves an audit event for the admin", async () => {
      const email = app.email("made");
      const created = await sam.api.post("/admin/users", { email, password: PASSWORD });
      expect(created.status).toBe(201);
      const event = await auditEvent(
        app,
        "user.created",
        (e) => e.resourceId === created.data.id,
      );
      expect(event).toMatchObject({ actorType: "admin", actorLabel: sam.email });
    });
  },
);
