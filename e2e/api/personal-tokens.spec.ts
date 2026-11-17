import {
  about,
  expect,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims, jwtHeader, verifiedByJwks } from "../harness/helpers.ts";
import { query } from "../harness/server.ts";
import {
  accessFor,
  auditEvents,
  makePat,
  setUserStatus,
  tradeQuietly,
  turnOff,
  turnOn,
} from "./tokens.support.ts";

const app = useServer();

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

test(
  "personal tokens are off by default",
  {
    tag: ["@tokens", "@smoke"],
    annotation: about(
      "A new instance has selfService.personalTokens off. Making a token is refused with FEATURE_DISABLED, while listing and deleting still answer, so a user is never locked out of cleaning up.",
    ),
  },
  async () => {
    const user = await app.user();
    await step("POST /auth/personal-tokens while the feature is off", async () => {
      const refused = await user.api.post("/auth/personal-tokens", {
        name: "laptop",
      });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("FEATURE_DISABLED");
    });
    await step("GET /auth/personal-tokens still answers, with nothing in it", async () => {
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.status).toBe(200);
      expect(list.message).toBe("PERSONAL_TOKENS_FETCHED");
      expect(list.data.items).toEqual([]);
    });
    await step("DELETE /auth/personal-tokens/{id} answers 404 for an unknown token", async () => {
      const gone = await user.api.delete("/auth/personal-tokens/pat_unknown");
      expect(gone.status).toBe(404);
      expect(gone.code).toBe("NOT_FOUND");
    });
  },
);

test(
  "a new personal token is shown once and never listed",
  {
    tag: ["@tokens", "@auth"],
    annotation: about(
      "Creating a token answers 201 with the dgp_ secret and its record. The list shows the record with the last four characters and never the secret.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const created = await step("POST /auth/personal-tokens with a name and an expiry", async () => {
      const expiresAt = inDays(30);
      const result = await user.api.post("/auth/personal-tokens", {
        name: "laptop-cli",
        expiresAt,
      });
      expect(result.status).toBe(201);
      expect(result.message).toBe("PERSONAL_TOKEN_CREATED");
      return { result, expiresAt };
    });
    const token = app.secret(created.result.data.token as string);
    await step("The token is dgp_ and 43 characters, and the record describes it", async () => {
      expect(token).toMatch(/^dgp_[A-Za-z0-9_-]{43}$/);
      const record = created.result.data.personalToken;
      expect(record).toMatchObject({
        name: "laptop-cli",
        lastFour: token.slice(-4),
        expired: false,
        lastUsedAt: null,
      });
      expect(record.id).toMatch(/^pat_/);
      expect(Date.parse(record.expiresAt)).toBe(Date.parse(created.expiresAt));
      expect(Date.parse(record.createdAt)).not.toBeNaN();
    });
    await step("GET /auth/personal-tokens lists it without the secret", async () => {
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.status).toBe(200);
      expect(list.data.items).toHaveLength(1);
      const [item] = list.data.items;
      expect(item).toMatchObject({
        id: created.result.data.personalToken.id,
        name: "laptop-cli",
        lastFour: token.slice(-4),
        expired: false,
      });
      expect(JSON.stringify(list.body)).not.toContain(token);
      expect(item).not.toHaveProperty("token");
    });
    await step("A token with no expiry has expiresAt null", async () => {
      const forever = await user.api.post("/auth/personal-tokens", {
        name: "forever",
      });
      expect(forever.status).toBe(201);
      app.secret(forever.data.token);
      expect(forever.data.personalToken.expiresAt).toBeNull();
    });
    await turnOff(app);
  },
);

test(
  "personal token names are one line of 1 to 64 characters, unique per user",
  {
    tag: ["@tokens"],
    annotation: about(
      "Empty, too long and multi-line names are REQUEST_INVALID. A name already in use by the same user is TOKEN_NAME_TAKEN, while another user may use the same name.",
    ),
  },
  async () => {
    await turnOn(app);
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    await step("POST with an empty name", async () => {
      const refused = await ana.api.post("/auth/personal-tokens", { name: "" });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("POST with a name of 65 characters", async () => {
      const refused = await ana.api.post("/auth/personal-tokens", {
        name: "a".repeat(65),
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("POST with a name on two lines", async () => {
      const refused = await ana.api.post("/auth/personal-tokens", {
        name: "line one\nline two",
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("POST with no name at all", async () => {
      const refused = await ana.api.post("/auth/personal-tokens", {});
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("A name of exactly 64 characters is accepted", async () => {
      const ok = await ana.api.post("/auth/personal-tokens", {
        name: "b".repeat(64),
      });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await step("The same name twice is TOKEN_NAME_TAKEN", async () => {
      const first = await ana.api.post("/auth/personal-tokens", { name: "ci" });
      expect(first.status).toBe(201);
      app.secret(first.data.token);
      const second = await ana.api.post("/auth/personal-tokens", { name: "ci" });
      expect(second.status).toBe(409);
      expect(second.code).toBe("TOKEN_NAME_TAKEN");
    });
    await step("Another user can use the same name", async () => {
      const other = await leo.api.post("/auth/personal-tokens", { name: "ci" });
      expect(other.status).toBe(201);
      app.secret(other.data.token);
    });
    await turnOff(app);
  },
);

test(
  "the expiry must be in the future and within three years",
  {
    tag: ["@tokens"],
    annotation: about(
      "An expiresAt in the past, more than three years ahead or not a date is REQUEST_INVALID. A date a little under three years out is accepted.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    for (const [title, expiresAt] of [
      ["in the past", "2020-01-01T00:00:00Z"],
      ["a minute ago", new Date(Date.now() - 60_000).toISOString()],
      ["more than three years ahead", inDays(3 * 365 + 40)],
      ["not a date", "next tuesday"],
    ] as const) {
      await step(`POST with an expiry ${title}`, async () => {
        const refused = await user.api.post("/auth/personal-tokens", {
          name: app.uniq("late"),
          expiresAt,
        });
        expect(refused.status).toBe(422);
        expect(refused.code).toBe("REQUEST_INVALID");
      });
    }
    await step("POST with an expiry just under three years ahead", async () => {
      const ok = await user.api.post("/auth/personal-tokens", {
        name: "long-lived",
        expiresAt: inDays(3 * 365 - 5),
      });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await step("No refused attempt left a token behind", async () => {
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.data.items.map((item: any) => item.name)).toEqual([
        "long-lived",
      ]);
    });
    await turnOff(app);
  },
);

test(
  "a user can hold only maxPersonalTokensPerUser tokens",
  {
    tag: ["@tokens", "@limits"],
    annotation: about(
      "With the cap at 2 the third token is LIMIT_REACHED. Deleting one frees a slot, and another user is not counted against it.",
    ),
  },
  async () => {
    await turnOn(app, { maxPersonalTokensPerUser: 2 });
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    const first = await makePat(app, ana, "one");
    await makePat(app, ana, "two");
    await step("POST a third token at the cap", async () => {
      const refused = await ana.api.post("/auth/personal-tokens", {
        name: "three",
      });
      expect(refused.status).toBe(409);
      expect(refused.code).toBe("LIMIT_REACHED");
    });
    await step("Another user still has room", async () => {
      const ok = await leo.api.post("/auth/personal-tokens", { name: "three" });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await step("DELETE one token, then the third fits", async () => {
      const deleted = await ana.api.delete(`/auth/personal-tokens/${first.id}`);
      expect(deleted.status).toBe(200);
      const ok = await ana.api.post("/auth/personal-tokens", { name: "three" });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await turnOff(app);
  },
);

test(
  "deleting a personal token is limited to its owner",
  {
    tag: ["@tokens", "@security"],
    annotation: about(
      "A user deletes their own token and gets PERSONAL_TOKEN_DELETED. Another user's token ID answers 404, and the token keeps working.",
    ),
  },
  async () => {
    await turnOn(app);
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    const mine = await makePat(app, ana, "mine");
    await step("DELETE another user's token ID", async () => {
      const refused = await leo.api.delete(`/auth/personal-tokens/${mine.id}`);
      expect(refused.status).toBe(404);
      expect(refused.code).toBe("NOT_FOUND");
    });
    await step("The token still trades", async () => {
      expect((await tradeQuietly(app, mine.token)).status).toBe(200);
    });
    await step("DELETE the token as its owner", async () => {
      const deleted = await ana.api.delete(`/auth/personal-tokens/${mine.id}`);
      expect(deleted.status).toBe(200);
      expect(deleted.message).toBe("PERSONAL_TOKEN_DELETED");
    });
    await step("It is gone from the list and a second delete is 404", async () => {
      const list = await ana.api.get("/auth/personal-tokens");
      expect(list.data.items).toEqual([]);
      const again = await ana.api.delete(`/auth/personal-tokens/${mine.id}`);
      expect(again.status).toBe(404);
    });
    await turnOff(app);
  },
);

test(
  "the personal token routes need a user's access token",
  {
    tag: ["@tokens", "@security"],
    annotation: about(
      "Without a token the routes answer 401. A console token and the service key are not users, so they get 403 AUTHORIZATION_DENIED.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    await step("GET /auth/personal-tokens with no credentials", async () => {
      const result = await app.api.get("/auth/personal-tokens");
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("POST /auth/personal-tokens with a garbage bearer token", async () => {
      const result = await app.api.post(
        "/auth/personal-tokens",
        { name: "x" },
        { token: "not-a-token" },
      );
      expect(result.status).toBe(401);
    });
    await step("GET /auth/personal-tokens with a console token", async () => {
      const result = await root.api.get("/auth/personal-tokens");
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("POST /auth/personal-tokens with the service key", async () => {
      const result = await app.service.post("/auth/personal-tokens", {
        name: "x",
      });
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await turnOff(app);
  },
);

test(
  "a personal token trades for a user access token without a refresh token",
  {
    tag: ["@tokens", "@auth"],
    annotation: about(
      "POST /auth/token with a dgp_ token answers an ES256 access token for the user, marked via pat with the token ID, no session and no refresh token. The signature checks out against the JWKS.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user("ana", { publicMetadata: { role: "manager" } });
    const pat = await makePat(app, user, "script");
    const traded = await step("POST /auth/token with the dgp_ token", () =>
      app.api.post("/auth/token", { token: pat.token }),
    );
    await step("It answers TOKEN_TRADED with a bearer access token and no refresh token", async () => {
      expect(traded.status).toBe(200);
      expect(traded.message).toBe("TOKEN_TRADED");
      expect(traded.data.tokenType).toBe("Bearer");
      expect(traded.data.expiresIn).toBe(900);
      expect(traded.data).not.toHaveProperty("refreshToken");
      expect(traded.setCookies).toEqual([]);
    });
    const access = traded.data.accessToken as string;
    await step("The claims name the user, via pat and the token ID", async () => {
      const token = claims(access);
      expect(token).toMatchObject({
        sub: user.id,
        kind: "human",
        via: "pat",
        tid: pat.id,
        email: user.email,
        email_verified: true,
        public_metadata: { role: "manager" },
        aud: token.iss,
      });
      expect(token.jti).toMatch(/^jti_/);
      expect(token).not.toHaveProperty("sid");
      expect(token.exp - token.iat).toBe(900);
    });
    await step("GET /.well-known/jwks.json verifies the ES256 signature", async () => {
      expect(jwtHeader(access)).toMatchObject({ alg: "ES256", typ: "JWT" });
      const jwks = await app.api.get("/.well-known/jwks.json");
      expect(jwks.status).toBe(200);
      expect(await verifiedByJwks(access, jwks.body)).toBe(true);
    });
    await turnOff(app);
  },
);

test(
  "a token's access token reads and edits the profile and nothing else",
  {
    tag: ["@tokens", "@security"],
    annotation: about(
      "An access token from a personal token is accepted by GET and PATCH /auth/me. Sessions, personal tokens, agents and password change refuse it with AUTHORIZATION_DENIED, so a leaked token can't make more of itself.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user("ana", { displayName: "Ana" });
    const pat = await makePat(app, user);
    const access = await accessFor(app, pat.token);
    const via = await app.newApi("pat-user", access);
    await step("GET /auth/me", async () => {
      const me = await via.get("/auth/me");
      expect(me.status).toBe(200);
      expect(me.message).toBe("ACCOUNT_FETCHED");
      expect(me.data.email).toBe(user.email);
    });
    await step("PATCH /auth/me changes the display name", async () => {
      const updated = await via.patch("/auth/me", { displayName: "Ana Via Token" });
      expect(updated.status).toBe(200);
      expect(updated.message).toBe("PROFILE_UPDATED");
      const seen = await user.api.get("/auth/me");
      expect(seen.data.displayName).toBe("Ana Via Token");
    });
    const denied: [string, string, unknown?][] = [
      ["GET", "/auth/sessions"],
      ["GET", "/auth/personal-tokens"],
      ["POST", "/auth/personal-tokens", { name: "more" }],
      ["GET", "/auth/agents"],
      ["POST", "/auth/agents", { name: "bot" }],
      [
        "POST",
        "/auth/password/change",
        { currentPassword: "correct horse battery", newPassword: "another long password" },
      ],
    ];
    for (const [method, path, body] of denied) {
      await step(`${method} ${path} with the traded token`, async () => {
        const result = await via.send(method, path, body);
        expect(result.status).toBe(403);
        expect(result.code).toBe("AUTHORIZATION_DENIED");
      });
    }
    await step("The user's own session still lists the token", async () => {
      const tokens = await user.api.get("/auth/personal-tokens");
      expect(tokens.data.items).toHaveLength(1);
    });
    await turnOff(app);
  },
);

test(
  "trading a personal token sets lastUsedAt",
  {
    tag: ["@tokens"],
    annotation: about(
      "A token that was never traded has lastUsedAt null. After a trade the list shows the time of the trade.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const pat = await makePat(app, user);
    await step("GET /auth/personal-tokens before any trade", async () => {
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.data.items[0].lastUsedAt).toBeNull();
    });
    await step("POST /auth/token with the token", async () => {
      const traded = await app.api.post("/auth/token", { token: pat.token });
      expect(traded.status).toBe(200);
    });
    await step("lastUsedAt is now set and recent", async () => {
      await expect
        .poll(async () => {
          const list = await user.api.get("/auth/personal-tokens", {
            record: false,
          });
          return list.data.items[0].lastUsedAt;
        })
        .not.toBeNull();
      const list = await user.api.get("/auth/personal-tokens");
      const used = Date.parse(list.data.items[0].lastUsedAt);
      expect(Math.abs(Date.now() - used)).toBeLessThan(60_000);
    });
    await turnOff(app);
  },
);

test(
  "an expired personal token is TOKEN_EXPIRED and stays in the list",
  {
    tag: ["@tokens"],
    annotation: about(
      "Once a token's expiry has passed, trading it answers 401 TOKEN_EXPIRED. The user still sees it, marked expired, until they delete it. The expiry is moved into the past in the database, since the API refuses a past date.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const pat = await makePat(app, user, "short", { expiresAt: inDays(1) });
    await step("The token trades before it expires", async () => {
      expect((await tradeQuietly(app, pat.token)).status).toBe(200);
    });
    await step("Its expiry moves into the past", async () => {
      await query(
        app.server.schema,
        "UPDATE personal_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1",
        [pat.id],
      );
    });
    await step("POST /auth/token answers TOKEN_EXPIRED", async () => {
      const refused = await app.api.post("/auth/token", { token: pat.token });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_EXPIRED");
    });
    await step("GET /auth/personal-tokens marks it expired", async () => {
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.data.items[0]).toMatchObject({ id: pat.id, expired: true });
    });
    await step("DELETE removes an expired token", async () => {
      const deleted = await user.api.delete(`/auth/personal-tokens/${pat.id}`);
      expect(deleted.status).toBe(200);
      const refused = await tradeQuietly(app, pat.token);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
    await turnOff(app);
  },
);

test(
  "a deleted personal token stops trading and its access token is refused",
  {
    tag: ["@tokens", "@security"],
    annotation: about(
      "After the owner deletes a token, trading it is TOKEN_INVALID, and an access token it already produced is refused by Dopgate at once.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const pat = await makePat(app, user);
    const access = await accessFor(app, pat.token);
    const via = await app.newApi("pat-user", access);
    await step("The access token works before the delete", async () => {
      expect((await via.get("/auth/me", { record: false })).status).toBe(200);
    });
    await step("DELETE /auth/personal-tokens/{id}", async () => {
      const deleted = await user.api.delete(`/auth/personal-tokens/${pat.id}`);
      expect(deleted.status).toBe(200);
    });
    await step("POST /auth/token with the deleted token", async () => {
      const refused = await app.api.post("/auth/token", { token: pat.token });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
    await step("The access token it gave is refused", async () => {
      const refused = await via.get("/auth/me");
      expect(refused.status).toBe(401);
    });
    await turnOff(app);
  },
);

test(
  "a disabled user's personal token is refused until they are enabled again",
  {
    tag: ["@tokens", "@users"],
    annotation: about(
      "Disabling the owner makes POST /auth/token answer 403 ACCOUNT_DISABLED. Enabling them makes the same token work again, and deleting them removes the token.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const pat = await makePat(app, user);
    await step("Disable the user", () => setUserStatus(app, user.id, false));
    await step("POST /auth/token answers ACCOUNT_DISABLED", async () => {
      const refused = await app.api.post("/auth/token", { token: pat.token });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("ACCOUNT_DISABLED");
    });
    await step("Enable the user: the same token works again", async () => {
      await setUserStatus(app, user.id, true);
      expect((await tradeQuietly(app, pat.token)).status).toBe(200);
    });
    await step("Delete the user: the token no longer matches", async () => {
      const deleted = await app.service.delete(`/admin/users/${user.id}`, undefined, {
        record: false,
      });
      expect(deleted.status).toBe(204);
      const refused = await tradeQuietly(app, pat.token);
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
    await turnOff(app);
  },
);

test(
  "turning the setting off keeps existing tokens working",
  {
    tag: ["@tokens", "@settings"],
    annotation: about(
      "With selfService.personalTokens off, new tokens are FEATURE_DISABLED. Tokens made earlier still trade, and the user can still list and delete them.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const pat = await makePat(app, user, "old");
    await step("Turn the setting off", () => turnOff(app));
    await step("POST /auth/personal-tokens is FEATURE_DISABLED", async () => {
      const refused = await user.api.post("/auth/personal-tokens", {
        name: "new",
      });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("FEATURE_DISABLED");
    });
    await step("The old token still trades", async () => {
      expect((await tradeQuietly(app, pat.token)).status).toBe(200);
    });
    await step("GET /auth/personal-tokens still lists it", async () => {
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.status).toBe(200);
      expect(list.data.items.map((item: any) => item.name)).toEqual(["old"]);
    });
    await step("DELETE /auth/personal-tokens/{id} still works", async () => {
      const deleted = await user.api.delete(`/auth/personal-tokens/${pat.id}`);
      expect(deleted.status).toBe(200);
    });
  },
);

test(
  "admins list a user's tokens and only the console revokes one",
  {
    tag: ["@tokens", "@admins"],
    annotation: about(
      "The console and the service key can list a user's tokens, without the secrets. Revoking needs the console: the service key gets 403. A revoked token stops trading and the revoke is audited with the admin as actor.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user();
    const pat = await makePat(app, user, "ci");
    const path = `/admin/users/${user.id}/personal-tokens`;
    await step("GET the user's tokens with the console token", async () => {
      const list = await root.api.get(path);
      expect(list.status).toBe(200);
      expect(list.message).toBe("PERSONAL_TOKENS_FETCHED");
      expect(list.data.items).toHaveLength(1);
      expect(list.data.items[0]).toMatchObject({ id: pat.id, name: "ci" });
      expect(JSON.stringify(list.body)).not.toContain(pat.token);
    });
    await step("GET the user's tokens with the service key", async () => {
      const list = await app.service.get(path);
      expect(list.status).toBe(200);
      expect(list.data.items[0].id).toBe(pat.id);
    });
    await step("GET tokens of an unknown user is 404", async () => {
      const missing = await root.api.get("/admin/users/usr_unknown/personal-tokens");
      expect(missing.status).toBe(404);
      expect(missing.code).toBe("NOT_FOUND");
    });
    await step("GET with a user's own token is refused", async () => {
      const denied = await user.api.get(path);
      expect(denied.status).toBe(403);
      expect(denied.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("DELETE with the service key is refused", async () => {
      const denied = await app.service.delete(`${path}/${pat.id}`);
      expect(denied.status).toBe(403);
      expect(denied.code).toBe("AUTHORIZATION_DENIED");
      expect((await tradeQuietly(app, pat.token)).status).toBe(200);
    });
    await step("DELETE an unknown token ID as the console is 404", async () => {
      const missing = await root.api.delete(`${path}/pat_unknown`);
      expect(missing.status).toBe(404);
      expect(missing.code).toBe("NOT_FOUND");
    });
    await step("DELETE the token as the console", async () => {
      const revoked = await root.api.delete(`${path}/${pat.id}`);
      expect(revoked.status).toBe(200);
      expect(revoked.message).toBe("PERSONAL_TOKEN_DELETED");
    });
    await step("The token stops trading and the user's list is empty", async () => {
      expect((await tradeQuietly(app, pat.token)).code).toBe("TOKEN_INVALID");
      const list = await user.api.get("/auth/personal-tokens");
      expect(list.data.items).toEqual([]);
    });
    await step("The revoke is in the audit log with the admin as actor", async () => {
      const events = await auditEvents(root.api, "personal_token.deleted");
      const event = events.find((item) => item.resourceId === pat.id);
      expect(event).toBeDefined();
      expect(event.actorType).toBe("root");
      expect(event.metadata).toMatchObject({ name: "ci", userId: user.id });
    });
    await turnOff(app);
  },
);

test(
  "personal token events are audited without the token",
  {
    tag: ["@tokens", "@audit"],
    annotation: about(
      "Creating and deleting a token are recorded with the user as actor and the token as the resource. Rejected trades are recorded as token.rejected with the last four characters of a dgp_ value and nothing of any other value.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user();
    const pat = await makePat(app, user, "audited");
    await step("DELETE the token as the user", async () => {
      const deleted = await user.api.delete(`/auth/personal-tokens/${pat.id}`, undefined, {
        record: false,
      });
      expect(deleted.status).toBe(200);
    });
    await step("personal_token.created names the user, the token and its name", async () => {
      const events = await auditEvents(root.api, "personal_token.created");
      const event = events.find((item) => item.resourceId === pat.id);
      expect(event).toBeDefined();
      expect(event.resourceType).toBe("personal_token");
      expect(event.metadata).toMatchObject({ name: "audited" });
      expect(JSON.stringify(event)).not.toContain(pat.token);
    });
    await step("personal_token.deleted is recorded for the user's own delete", async () => {
      const events = await auditEvents(root.api, "personal_token.deleted");
      const event = events.find((item) => item.resourceId === pat.id);
      expect(event).toBeDefined();
      expect(event.metadata).toMatchObject({ name: "audited" });
      expect(event.metadata).not.toHaveProperty("userId");
    });
    await step("A rejected dgp_ value keeps only its last four characters", async () => {
      const fake = `dgp_${"x".repeat(39)}ab12`;
      const refused = await app.api.post("/auth/token", { token: fake });
      expect(refused.code).toBe("TOKEN_INVALID");
      const events = await auditEvents(root.api, "token.rejected");
      const event = events.find((item) => item.metadata?.kind === "personal");
      expect(event).toBeDefined();
      expect(event.metadata.lastFour).toBe("ab12");
      expect(JSON.stringify(event)).not.toContain("xxxxxxxx");
    });
    await step("A value without a known prefix keeps nothing", async () => {
      const refused = await app.api.post("/auth/token", {
        token: app.value(),
      });
      expect(refused.code).toBe("TOKEN_INVALID");
      const events = await auditEvents(root.api, "token.rejected");
      const event = events.find((item) => item.metadata?.kind === "unknown");
      expect(event).toBeDefined();
      expect(event.metadata).toEqual({ kind: "unknown" });
    });
    await turnOff(app);
  },
);
