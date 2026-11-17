import { about, expect, step, test, useServer } from "../harness/index.ts";
import { claims, jwtHeader, verifiedByJwks } from "../harness/helpers.ts";
import {
  accessFor,
  auditEvents,
  makeAgent,
  makePat,
  tradeQuietly,
  turnOff,
  turnOn,
} from "./tokens.support.ts";

const app = useServer();

test(
  "an agent token trades for an agent access token signed with ES256",
  {
    tag: ["@agents", "@tokens", "@smoke"],
    annotation: about(
      "POST /auth/token with a dga_ token answers an access token with kind agent, the agent as subject, its owner and its capabilities. It has no email, session or profile claims, no refresh token, and its signature checks out against the JWKS.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user("ana", { publicMetadata: { role: "manager" } });
    const capabilities = {
      repo: "dopgate",
      max_files: 20,
      can_merge: false,
      labels: ["bot"],
    };
    const bot = await makeAgent(app, user, { name: "cursor", capabilities });
    const traded = await step("POST /auth/token with the dga_ token", () =>
      app.api.post("/auth/token", { token: bot.token }),
    );
    await step("It answers TOKEN_TRADED with a bearer token and no refresh token", async () => {
      expect(traded.status).toBe(200);
      expect(traded.message).toBe("TOKEN_TRADED");
      expect(traded.data.tokenType).toBe("Bearer");
      expect(traded.data.expiresIn).toBe(900);
      expect(traded.data).not.toHaveProperty("refreshToken");
      expect(traded.setCookies).toEqual([]);
    });
    const access = traded.data.accessToken as string;
    await step("The claims name the agent, its owner and its capabilities", async () => {
      const token = claims(access);
      expect(token).toMatchObject({
        sub: bot.id,
        kind: "agent",
        owner: user.id,
        capabilities,
      });
      expect(token.iss).toBe(app.url);
      expect(token.aud).toBe(token.iss);
      expect(token.jti).toMatch(/^jti_/);
      expect(token.exp - token.iat).toBe(900);
    });
    await step("The claims carry nothing of the owner's profile", async () => {
      const token = claims(access);
      for (const absent of [
        "email",
        "email_verified",
        "sid",
        "via",
        "tid",
        "name",
        "role",
        "public_metadata",
      ]) {
        expect(token, absent).not.toHaveProperty(absent);
      }
    });
    await step("GET /.well-known/jwks.json verifies the signature", async () => {
      expect(jwtHeader(access)).toMatchObject({ alg: "ES256", typ: "JWT" });
      const jwks = await app.api.get("/.well-known/jwks.json");
      expect(await verifiedByJwks(access, jwks.body)).toBe(true);
    });
    await step("Every trade gets a new jti", async () => {
      const second = await accessFor(app, bot.token);
      expect(claims(second).jti).not.toBe(claims(access).jti);
    });
    await turnOff(app);
  },
);

test(
  "an admin's agent trades for a token owned by the admin",
  {
    tag: ["@agents", "@tokens"],
    annotation: about(
      "An agent made in the console has an adm_ owner in its access token, with no user involved.",
    ),
  },
  async () => {
    const root = await app.root();
    const bot = await makeAgent(app, root, {
      name: "admins-bot",
      capabilities: { invoices: "read" },
    });
    await step("POST /auth/token with the agent's token", async () => {
      const traded = await app.api.post("/auth/token", { token: bot.token });
      expect(traded.status).toBe(200);
      const token = claims(traded.data.accessToken);
      expect(token).toMatchObject({
        sub: bot.id,
        kind: "agent",
        owner: root.id,
        capabilities: { invoices: "read" },
      });
      expect(token.owner).toMatch(/^adm_/);
    });
  },
);

test(
  "an agent with no capabilities gets an empty object in its token",
  {
    tag: ["@agents", "@tokens"],
    annotation: about(
      "Capabilities left out at creation are stored as an empty object, and the access token carries that object.",
    ),
  },
  async () => {
    const root = await app.root();
    const bot = await makeAgent(app, root, { name: "bare-bot" });
    await step("POST /auth/token", async () => {
      const traded = await app.api.post("/auth/token", { token: bot.token });
      expect(traded.status).toBe(200);
      expect(claims(traded.data.accessToken).capabilities).toEqual({});
    });
  },
);

test(
  "capability changes show up in the next access token",
  {
    tag: ["@agents", "@tokens"],
    annotation: about(
      "An access token is a snapshot. After the owner edits the capabilities, the old access token keeps its old values and the next trade carries the new ones.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, {
      name: "changing",
      capabilities: { tier: "free" },
    });
    const before = await step("POST /auth/token before the edit", () =>
      app.api.post("/auth/token", { token: bot.token }),
    );
    await step("The owner replaces the capabilities", async () => {
      const updated = await user.api.patch(`/auth/agents/${bot.id}`, {
        capabilities: { tier: "pro", seats: 3 },
      }, { record: false });
      expect(updated.status).toBe(200);
    });
    await step("POST /auth/token after the edit carries the new capabilities", async () => {
      const after = await app.api.post("/auth/token", { token: bot.token });
      expect(claims(after.data.accessToken).capabilities).toEqual({
        tier: "pro",
        seats: 3,
      });
    });
    await step("The earlier access token still says free", async () => {
      expect(claims(before.data.accessToken).capabilities).toEqual({ tier: "free" });
    });
    await turnOff(app);
  },
);

test(
  "an agent's access token is refused by every Dopgate endpoint",
  {
    tag: ["@agents", "@security"],
    annotation: about(
      "Agent tokens are for the app's backend. The profile, session, token, agent, admin and console routes all answer 403 AUTHORIZATION_DENIED to one, including routes that otherwise accept an access token.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "locked-out" });
    const asAgent = await app.newApi("agent", await accessFor(app, bot.token));
    const routes: [string, string, unknown?][] = [
      ["GET", "/auth/me"],
      ["PATCH", "/auth/me", { displayName: "Agent" }],
      ["GET", "/auth/sessions"],
      ["DELETE", "/auth/sessions"],
      ["GET", "/auth/personal-tokens"],
      ["POST", "/auth/personal-tokens", { name: "from-agent" }],
      ["GET", "/auth/agents"],
      ["POST", "/auth/agents", { name: "from-agent" }],
      ["GET", `/auth/agents/${bot.id}`],
      [
        "POST",
        "/auth/password/change",
        { currentPassword: "x", newPassword: "another long password" },
      ],
      ["GET", "/admin/users"],
      ["GET", "/admin/agents"],
      ["GET", "/admin/settings"],
      ["GET", "/admin/audit-events"],
      ["GET", "/console/me"],
    ];
    for (const [method, path, body] of routes) {
      await step(`${method} ${path} with the agent's access token`, async () => {
        const result = await asAgent.send(method, path, body);
        expect(result.status).toBe(403);
        expect(result.code).toBe("AUTHORIZATION_DENIED");
      });
    }
    await step("Nothing the agent tried changed the owner", async () => {
      const me = await user.api.get("/auth/me", { record: false });
      expect(me.data.email).toBe(user.email);
      expect((await user.api.get("/auth/personal-tokens", { record: false })).data.items).toEqual([]);
      expect((await user.api.get("/auth/agents", { record: false })).data.items).toHaveLength(1);
    });
    await turnOff(app);
  },
);

test(
  "a disabled agent cannot trade until it is turned on",
  {
    tag: ["@agents", "@tokens"],
    annotation: about(
      "A disabled agent's token answers 403 AGENT_DISABLED. Turning the agent on makes the same token work.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "paused" });
    await step("Disable the agent", async () => {
      const off = await user.api.post(`/auth/agents/${bot.id}/disable`, undefined, {
        record: false,
      });
      expect(off.status).toBe(200);
    });
    await step("POST /auth/token answers AGENT_DISABLED", async () => {
      const refused = await app.api.post("/auth/token", { token: bot.token });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
      expect(refused.body.data).toBeUndefined();
    });
    await step("Enable the agent: the same token trades", async () => {
      await user.api.post(`/auth/agents/${bot.id}/enable`, undefined, { record: false });
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await turnOff(app);
  },
);

test(
  "trading an agent token sets lastUsedAt",
  {
    tag: ["@agents", "@tokens"],
    annotation: about(
      "A new agent has lastUsedAt null. After a trade the owner's read of it shows a recent time.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "used" });
    await step("POST /auth/token with the agent's token", async () => {
      expect((await app.api.post("/auth/token", { token: bot.token })).status).toBe(200);
    });
    await step("GET /auth/agents/{id} shows lastUsedAt", async () => {
      await expect
        .poll(async () => {
          const read = await user.api.get(`/auth/agents/${bot.id}`, { record: false });
          return read.data.lastUsedAt;
        })
        .not.toBeNull();
      const read = await user.api.get(`/auth/agents/${bot.id}`, { record: false });
      expect(Math.abs(Date.now() - Date.parse(read.data.lastUsedAt))).toBeLessThan(60_000);
    });
    await turnOff(app);
  },
);

test(
  "values that are not a token are TOKEN_INVALID",
  {
    tag: ["@tokens", "@security"],
    annotation: about(
      "Garbage, a wrong length, a wrong prefix, a real token with its prefix swapped and an unknown dga_ or dgp_ value all answer 401 TOKEN_INVALID. A body without a token is REQUEST_INVALID.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const pat = await makePat(app, user);
    const bot = await makeAgent(app, user, { name: "real" });
    const body43 = "a".repeat(43);
    const cases: [string, string][] = [
      ["plain garbage", "garbage"],
      ["an empty string", ""],
      ["only a prefix", "dga_"],
      ["a dga_ token that is too short", `dga_${"a".repeat(42)}`],
      ["a dga_ token that is too long", `dga_${"a".repeat(44)}`],
      ["a dgp_ token that is too short", `dgp_${"a".repeat(10)}`],
      ["an unknown prefix of the right length", `xyz_${body43}`],
      ["no prefix at all", body43],
      ["a made-up dga_ token", `dga_${body43}`],
      ["a made-up dgp_ token", `dgp_${body43}`],
      ["a personal token with the agent prefix", `dga_${pat.token.slice(4)}`],
      ["an agent token with the personal prefix", `dgp_${bot.token.slice(4)}`],
      ["an agent token in capitals", bot.token.toUpperCase()],
    ];
    for (const [title, token] of cases) {
      await step(`POST /auth/token with ${title}`, async () => {
        const refused = await app.api.post("/auth/token", { token });
        expect(refused.status).toBe(401);
        expect(refused.code).toBe("TOKEN_INVALID");
        expect(refused.body.data).toBeUndefined();
      });
    }
    await step("POST /auth/token with no token field", async () => {
      const refused = await app.api.post("/auth/token", {});
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("POST /auth/token with a token that is not a string", async () => {
      const refused = await app.api.post("/auth/token", { token: 12345 });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    });
    await step("The real tokens still work", async () => {
      expect((await tradeQuietly(app, pat.token)).status).toBe(200);
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await turnOff(app);
  },
);

test(
  "only dgp_ and dga_ tokens are accepted, not sessions or keys",
  {
    tag: ["@tokens", "@security"],
    annotation: about(
      "A refresh token, an access token, a console token and the service key are all TOKEN_INVALID at /auth/token. A refresh token is not used up by the attempt.",
    ),
  },
  async () => {
    const root = await app.root();
    const user = await app.user();
    const refresh = user.tokens!.refreshToken as string;
    const candidates: [string, string][] = [
      ["a refresh token", refresh],
      ["a user's access token", user.tokens!.accessToken],
      ["a console access token", root.tokens.accessToken],
      ["the service key", app.serviceKey],
    ];
    for (const [title, token] of candidates) {
      await step(`POST /auth/token with ${title}`, async () => {
        const refused = await app.api.post("/auth/token", { token });
        expect(refused.status).toBe(401);
        expect(refused.code).toBe("TOKEN_INVALID");
      });
    }
    await step("The refresh token still refreshes the session", async () => {
      const refreshed = await app.api.post(
        "/auth/refresh",
        { refreshToken: refresh },
        { record: false },
      );
      expect(refreshed.status).toBe(200);
    });
    await step("A bearer header on the trade call is ignored", async () => {
      const refused = await user.api.post("/auth/token", { token: "garbage" });
      expect(refused.code).toBe("TOKEN_INVALID");
    });
  },
);

test(
  "rejected trades are audited without the secret",
  {
    tag: ["@tokens", "@audit"],
    annotation: about(
      "An unknown dga_ value records agent.token_rejected with its last four characters. Tokens of other shapes record token.rejected with nothing of the value. Successful trades record nothing.",
    ),
  },
  async () => {
    const root = await app.root();
    const mark = app.uniq("zq");
    const unknownAgent = `dga_${"q".repeat(39)}wxyz`;
    const unknownPersonal = `dgp_${"q".repeat(39)}1234`;
    const stray = `${mark}-not-a-token`;
    await step("POST /auth/token with three unknown values", async () => {
      for (const token of [unknownAgent, unknownPersonal, stray]) {
        const refused = await app.api.post("/auth/token", { token });
        expect(refused.code).toBe("TOKEN_INVALID");
      }
    });
    await step("agent.token_rejected keeps kind and last four", async () => {
      const events = await auditEvents(root.api, "agent.token_rejected");
      const event = events.find((item) => item.metadata?.lastFour === "wxyz");
      expect(event).toBeDefined();
      expect(event.actorType).toBe("anonymous");
      expect(event.metadata).toEqual({ kind: "agent", lastFour: "wxyz" });
    });
    await step("token.rejected keeps the last four of a dgp_ value only", async () => {
      const events = await auditEvents(root.api, "token.rejected");
      const personal = events.find((item) => item.metadata?.lastFour === "1234");
      expect(personal?.metadata).toEqual({ kind: "personal", lastFour: "1234" });
      const unknown = events.find((item) => item.metadata?.kind === "unknown");
      expect(unknown?.metadata).toEqual({ kind: "unknown" });
    });
    await step("No audit event holds a fragment of any value", async () => {
      const all = await root.api.get("/admin/audit-events?limit=200");
      const text = JSON.stringify(all.body);
      expect(text).not.toContain("qqqqqqqq");
      expect(text).not.toContain(mark);
    });
  },
);

test(
  "the trade route shares the per-address request limit",
  {
    tag: ["@tokens", "@limits"],
    annotation: about(
      "With ipRequestsPerMinute lowered to 3, repeated trades from one address end in 429 RATE_LIMITED with a Retry-After header, even for a wrong token. The limit is put back afterwards and trades work again.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "busy" });
    await step("Lower ipRequestsPerMinute to 3", async () => {
      await app.settings("limits", { ipRequestsPerMinute: 3 });
    });
    try {
      const limited = await step("POST /auth/token until the limit answers", async () => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const result = await app.api.post("/auth/token", { token: bot.token });
          if (result.status === 429) return result;
          expect(result.status).toBe(200);
        }
        throw new Error("The trade route never answered 429");
      });
      await step("The answer is RATE_LIMITED with Retry-After", async () => {
        expect(limited.code).toBe("RATE_LIMITED");
        expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      });
      await step("A wrong token from the same address is limited too", async () => {
        const refused = await app.api.post("/auth/token", { token: "garbage" });
        expect(refused.status).toBe(429);
        expect(refused.code).toBe("RATE_LIMITED");
      });
    } finally {
      await app.settings("limits", { ipRequestsPerMinute: 10_000 });
    }
    await step("With the limit back up, the token trades again", async () => {
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await turnOff(app);
  },
);
