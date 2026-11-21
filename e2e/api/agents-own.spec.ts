import { about, expect, step, test, useServer } from "../harness/index.ts";
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
  "user agents are off by default",
  {
    tag: ["@agents", "@smoke"],
    annotation: about(
      "A new instance has selfService.agents off. Making an agent is refused with FEATURE_DISABLED, and listing still answers.",
    ),
  },
  async () => {
    const user = await app.user();
    await step("POST /auth/agents while the feature is off", async () => {
      const refused = await user.api.post("/auth/agents", { name: "bot" });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("FEATURE_DISABLED");
    });
    await step("GET /auth/agents answers with an empty page", async () => {
      const list = await user.api.get("/auth/agents");
      expect(list.status).toBe(200);
      expect(list.message).toBe("AGENTS_FETCHED");
      expect(list.data).toEqual({ items: [], nextCursor: null });
    });
  },
);

test(
  "a new agent is shown with its token once and never again",
  {
    tag: ["@agents", "@smoke"],
    annotation: about(
      "Creating an agent answers 201 with the dga_ token and the agent: owner, capabilities, status and last four characters. Reading or listing it later never shows the token.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user("ana");
    const capabilities = {
      repo: "dopgate",
      max_files: 20,
      can_merge: false,
      labels: ["bot"],
    };
    const created = await step("POST /auth/agents with a name, a description and capabilities", () =>
      user.api.post("/auth/agents", {
        name: "cursor",
        description: "Opens pull requests",
        capabilities,
      }),
    );
    const token = app.secret(created.data.token as string);
    const agent = created.data.agent;
    await step("It answers AGENT_CREATED with a dga_ token of 43 characters", async () => {
      expect(created.status).toBe(201);
      expect(created.message).toBe("AGENT_CREATED");
      expect(token).toMatch(/^dga_[A-Za-z0-9_-]{43}$/);
    });
    await step("The agent has its owner, capabilities and status", async () => {
      expect(agent).toMatchObject({
        name: "cursor",
        description: "Opens pull requests",
        owner: { id: user.id, kind: "user", email: user.email },
        capabilities,
        status: "active",
        lastFour: token.slice(-4),
        lastUsedAt: null,
      });
      expect(agent.id).toMatch(/^agt_/);
      expect(Date.parse(agent.createdAt)).not.toBeNaN();
      expect(agent.updatedAt).toBe(agent.createdAt);
    });
    await step("GET /auth/agents/{id} returns the agent without a token", async () => {
      const read = await user.api.get(`/auth/agents/${agent.id}`);
      expect(read.status).toBe(200);
      expect(read.message).toBe("AGENT_FETCHED");
      expect(read.data).toEqual(agent);
      expect(JSON.stringify(read.body)).not.toContain(token);
    });
    await step("GET /auth/agents lists it without a token", async () => {
      const list = await user.api.get("/auth/agents");
      expect(list.data.items).toEqual([agent]);
      expect(JSON.stringify(list.body)).not.toContain(token);
    });
    await step("An agent made with only a name has no description and empty capabilities", async () => {
      const bare = await user.api.post("/auth/agents", { name: "bare" });
      expect(bare.status).toBe(201);
      app.secret(bare.data.token);
      expect(bare.data.agent.description).toBeNull();
      expect(bare.data.agent.capabilities).toEqual({});
    });
    await turnOff(app);
  },
);

test(
  "agent names are lowercase letters, digits and dashes, unique per owner",
  {
    tag: ["@agents"],
    annotation: about(
      "Uppercase, spaces, empty, 65 characters and a missing name are REQUEST_INVALID. A name the owner already uses is AGENT_NAME_TAKEN, while another user may use it. A description over 280 characters or on two lines is REQUEST_INVALID.",
    ),
  },
  async () => {
    await turnOn(app);
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    for (const [title, body] of [
      ["uppercase letters", { name: "Has-Caps" }],
      ["a space", { name: "has space" }],
      ["an underscore", { name: "has_underscore" }],
      ["an empty name", { name: "" }],
      ["a name of 65 characters", { name: "a".repeat(65) }],
      ["no name", {}],
      ["a description of 281 characters", { name: "okay", description: "d".repeat(281) }],
      ["a description on two lines", { name: "okay", description: "one\ntwo" }],
    ] as const) {
      await step(`POST /auth/agents with ${title}`, async () => {
        const refused = await ana.api.post("/auth/agents", body);
        expect(refused.status).toBe(422);
        expect(refused.code).toBe("REQUEST_INVALID");
      });
    }
    await step("A name of 64 characters and a description of 280 are accepted", async () => {
      const ok = await ana.api.post("/auth/agents", {
        name: "a".repeat(64),
        description: "d".repeat(280),
      });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await step("Digits and dashes are accepted", async () => {
      const ok = await ana.api.post("/auth/agents", { name: "bot-2-b" });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await step("The same name again is AGENT_NAME_TAKEN", async () => {
      const taken = await ana.api.post("/auth/agents", { name: "bot-2-b" });
      expect(taken.status).toBe(409);
      expect(taken.code).toBe("AGENT_NAME_TAKEN");
    });
    await step("Another user can use the same name", async () => {
      const ok = await leo.api.post("/auth/agents", { name: "bot-2-b" });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await turnOff(app);
  },
);

test(
  "capabilities must be a flat object of strings, numbers, booleans and string lists",
  {
    tag: ["@agents"],
    annotation: about(
      "The accepted grammar is a flat JSON object of at most 4 KB. Keys are 1 to 64 letters, digits, underscore, dot or colon. Values are a string, number, boolean or a list of at most 100 strings. Everything else is CAPABILITIES_INVALID.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    await step("POST with keys using underscore, dot and colon, and every value type", async () => {
      const ok = await user.api.post("/auth/agents", {
        name: "all-types",
        capabilities: {
          "plain_key": "text",
          "dotted.key": 1.5,
          "colon:key": true,
          negative: -3,
          flag: false,
          tags: ["a", "b"],
          none: [],
          [`k${"x".repeat(63)}`]: "longest key",
        },
      });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
      expect(ok.data.agent.capabilities.tags).toEqual(["a", "b"]);
    });
    await step("A list of exactly 100 strings is accepted", async () => {
      const ok = await user.api.post("/auth/agents", {
        name: "hundred",
        capabilities: { items: Array.from({ length: 100 }, (_, i) => `i${i}`) },
      });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    const refused: [string, unknown][] = [
      ["an array instead of an object", []],
      ["a string instead of an object", "admin"],
      ["a nested object", { nested: { a: 1 } }],
      ["a null value", { gone: null }],
      ["a list of numbers", { nums: [1, 2] }],
      ["a list holding an object", { mixed: ["a", { b: 1 }] }],
      ["a list of 101 strings", { items: Array.from({ length: 101 }, () => "x") }],
      ["a key with a space", { "bad key": "x" }],
      ["a key with a dash", { "bad-key": "x" }],
      ["an empty key", { "": "x" }],
      ["a key of 65 characters", { ["k".repeat(65)]: "x" }],
      ["an object over 4 KB", { big: "x".repeat(5000) }],
    ];
    for (const [title, capabilities] of refused) {
      await step(`POST with ${title}`, async () => {
        const result = await user.api.post("/auth/agents", {
          name: app.uniq("cap"),
          capabilities,
        });
        expect(result.status).toBe(422);
        expect(result.code).toBe("CAPABILITIES_INVALID");
      });
    }
    await step("None of the refused attempts made an agent", async () => {
      const list = await user.api.get("/auth/agents");
      expect(list.data.items.map((item: any) => item.name).sort()).toEqual([
        "all-types",
        "hundred",
      ]);
    });
    await turnOff(app);
  },
);

test(
  "a user can own only maxAgentsPerUser agents",
  {
    tag: ["@agents", "@limits"],
    annotation: about(
      "With the cap at 2 the third agent is LIMIT_REACHED. Deleting one frees a slot, and another user is not counted.",
    ),
  },
  async () => {
    await turnOn(app, { maxAgentsPerUser: 2 });
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    const first = await makeAgent(app, ana, { name: "one" });
    await makeAgent(app, ana, { name: "two" });
    await step("POST a third agent at the cap", async () => {
      const refused = await ana.api.post("/auth/agents", { name: "three" });
      expect(refused.status).toBe(409);
      expect(refused.code).toBe("LIMIT_REACHED");
    });
    await step("Another user still has room", async () => {
      const ok = await leo.api.post("/auth/agents", { name: "three" });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await step("DELETE one agent, then the third fits", async () => {
      const deleted = await ana.api.delete(`/auth/agents/${first.id}`);
      expect(deleted.status).toBe(204);
      const ok = await ana.api.post("/auth/agents", { name: "three" });
      expect(ok.status).toBe(201);
      app.secret(ok.data.token);
    });
    await turnOff(app);
  },
);

test(
  "PATCH keeps the fields left out and replaces capabilities whole",
  {
    tag: ["@agents"],
    annotation: about(
      "Sending only a description leaves the name and capabilities alone. Sending capabilities replaces the whole object, an empty description clears it, and a rename to a name already in use is AGENT_NAME_TAKEN.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    await makeAgent(app, user, { name: "taken" });
    const bot = await makeAgent(app, user, {
      name: "editable",
      description: "first",
      capabilities: { tier: "free", region: "eu" },
    });
    const path = `/auth/agents/${bot.id}`;
    await step("PATCH with only a description", async () => {
      const updated = await user.api.patch(path, { description: "second" });
      expect(updated.status).toBe(200);
      expect(updated.message).toBe("AGENT_UPDATED");
      expect(updated.data).toMatchObject({
        name: "editable",
        description: "second",
        capabilities: { tier: "free", region: "eu" },
      });
      expect(Date.parse(updated.data.updatedAt)).toBeGreaterThan(
        Date.parse(bot.agent.updatedAt),
      );
    });
    await step("PATCH with capabilities replaces the whole object", async () => {
      const updated = await user.api.patch(path, {
        capabilities: { tier: "pro" },
      });
      expect(updated.data.capabilities).toEqual({ tier: "pro" });
      expect(updated.data.description).toBe("second");
    });
    await step("PATCH with an empty capabilities object clears them", async () => {
      const updated = await user.api.patch(path, { capabilities: {} });
      expect(updated.data.capabilities).toEqual({});
    });
    await step("PATCH with an empty description clears it", async () => {
      const updated = await user.api.patch(path, { description: "" });
      expect(updated.data.description).toBeNull();
    });
    await step("PATCH renames the agent and the token still works", async () => {
      const updated = await user.api.patch(path, { name: "renamed" });
      expect(updated.status).toBe(200);
      expect(updated.data.name).toBe("renamed");
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await step("PATCH to a name another agent has is AGENT_NAME_TAKEN", async () => {
      const refused = await user.api.patch(path, { name: "taken" });
      expect(refused.status).toBe(409);
      expect(refused.code).toBe("AGENT_NAME_TAKEN");
    });
    await step("PATCH with an invalid name, capabilities or description is refused", async () => {
      const name = await user.api.patch(path, { name: "No Good" });
      expect(name.status).toBe(422);
      expect(name.code).toBe("REQUEST_INVALID");
      const caps = await user.api.patch(path, { capabilities: { a: { b: 1 } } });
      expect(caps.status).toBe(422);
      expect(caps.code).toBe("CAPABILITIES_INVALID");
      const description = await user.api.patch(path, {
        description: "d".repeat(281),
      });
      expect(description.status).toBe(422);
      expect(description.code).toBe("REQUEST_INVALID");
    });
    await step("The agent is unchanged by the refused edits", async () => {
      const read = await user.api.get(path);
      expect(read.data).toMatchObject({
        name: "renamed",
        description: null,
        capabilities: {},
      });
    });
    await turnOff(app);
  },
);

test(
  "regenerating an agent's token stops the old one",
  {
    tag: ["@agents", "@security"],
    annotation: about(
      "POST regenerate answers a new token and the agent with the new last four characters. The old token is TOKEN_INVALID from then on, and the new one trades.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "rotating" });
    const regenerated = await step("POST /auth/agents/{id}/regenerate", () =>
      user.api.post(`/auth/agents/${bot.id}/regenerate`),
    );
    const fresh = app.secret(regenerated.data.token as string);
    await step("It answers AGENT_TOKEN_REGENERATED with a different dga_ token", async () => {
      expect(regenerated.status).toBe(200);
      expect(regenerated.message).toBe("AGENT_TOKEN_REGENERATED");
      expect(fresh).toMatch(/^dga_[A-Za-z0-9_-]{43}$/);
      expect(fresh).not.toBe(bot.token);
      expect(regenerated.data.agent.id).toBe(bot.id);
      expect(regenerated.data.agent.lastFour).toBe(fresh.slice(-4));
    });
    await step("The old token is TOKEN_INVALID", async () => {
      const refused = await app.api.post("/auth/token", { token: bot.token });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
    await step("The new token trades", async () => {
      expect((await tradeQuietly(app, fresh)).status).toBe(200);
    });
    await step("GET shows the new last four characters", async () => {
      const read = await user.api.get(`/auth/agents/${bot.id}`);
      expect(read.data.lastFour).toBe(fresh.slice(-4));
    });
    await turnOff(app);
  },
);

test(
  "an owner turns an agent off and on",
  {
    tag: ["@agents"],
    annotation: about(
      "Disable sets the status to disabled and the agent's token is refused with AGENT_DISABLED. Enable turns it back on and the same token works. Doing either twice is harmless.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "switch" });
    await step("POST /auth/agents/{id}/disable", async () => {
      const off = await user.api.post(`/auth/agents/${bot.id}/disable`);
      expect(off.status).toBe(200);
      expect(off.message).toBe("AGENT_DISABLED");
      expect(off.data.status).toBe("disabled");
    });
    await step("The token is AGENT_DISABLED while it is off", async () => {
      const refused = await app.api.post("/auth/token", { token: bot.token });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
    });
    await step("Disabling again still answers 200", async () => {
      const again = await user.api.post(`/auth/agents/${bot.id}/disable`, undefined, {
        record: false,
      });
      expect(again.status).toBe(200);
      expect(again.data.status).toBe("disabled");
    });
    await step("POST /auth/agents/{id}/enable", async () => {
      const on = await user.api.post(`/auth/agents/${bot.id}/enable`);
      expect(on.status).toBe(200);
      expect(on.message).toBe("AGENT_ENABLED");
      expect(on.data.status).toBe("active");
    });
    await step("The same token trades again", async () => {
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await turnOff(app);
  },
);

test(
  "deleting an agent ends its token",
  {
    tag: ["@agents"],
    annotation: about(
      "DELETE answers 204 with no body. The agent is then 404, gone from the list, and its token is TOKEN_INVALID. The name can be used again.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "short-lived" });
    await step("DELETE /auth/agents/{id}", async () => {
      const deleted = await user.api.delete(`/auth/agents/${bot.id}`);
      expect(deleted.status).toBe(204);
      expect(deleted.body).toBeUndefined();
    });
    await step("GET /auth/agents/{id} is 404 and the list is empty", async () => {
      const read = await user.api.get(`/auth/agents/${bot.id}`);
      expect(read.status).toBe(404);
      expect(read.code).toBe("NOT_FOUND");
      expect((await user.api.get("/auth/agents")).data.items).toEqual([]);
    });
    await step("A second DELETE is 404", async () => {
      const again = await user.api.delete(`/auth/agents/${bot.id}`);
      expect(again.status).toBe(404);
    });
    await step("The token is TOKEN_INVALID", async () => {
      expect((await tradeQuietly(app, bot.token)).code).toBe("TOKEN_INVALID");
    });
    await step("The name is free again", async () => {
      const again = await user.api.post("/auth/agents", { name: "short-lived" });
      expect(again.status).toBe(201);
      app.secret(again.data.token);
    });
    await turnOff(app);
  },
);

test(
  "another user's agent looks like it does not exist",
  {
    tag: ["@agents", "@security"],
    annotation: about(
      "Every route that takes an agent ID answers 404 NOT_FOUND for an agent another user owns, and the list shows only the caller's own agents. The agent is untouched.",
    ),
  },
  async () => {
    await turnOn(app);
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    const bot = await makeAgent(app, ana, { name: "private-bot" });
    const probes: [string, string, unknown?][] = [
      ["GET", ""],
      ["PATCH", "", { description: "mine now" }],
      ["POST", "/regenerate"],
      ["POST", "/disable"],
      ["POST", "/enable"],
      ["DELETE", ""],
    ];
    for (const [method, suffix, body] of probes) {
      await step(`${method} /auth/agents/{id}${suffix} as another user`, async () => {
        const result = await leo.api.send(method, `/auth/agents/${bot.id}${suffix}`, body);
        expect(result.status).toBe(404);
        expect(result.code).toBe("NOT_FOUND");
      });
    }
    await step("GET /auth/agents for the other user is empty", async () => {
      const list = await leo.api.get("/auth/agents");
      expect(list.data.items).toEqual([]);
    });
    await step("The agent is unchanged and its token still trades", async () => {
      const read = await ana.api.get(`/auth/agents/${bot.id}`);
      expect(read.data).toEqual(bot.agent);
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await turnOff(app);
  },
);

test(
  "the agent list is newest first and pages with a cursor",
  {
    tag: ["@agents"],
    annotation: about(
      "Three agents list newest first. With limit 2 the first page has a nextCursor, the second page holds the last one and has none. A made-up cursor is REQUEST_INVALID.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    for (const name of ["first", "second", "third"]) {
      await makeAgent(app, user, { name });
    }
    const page = await step("GET /auth/agents?limit=2", () =>
      user.api.get("/auth/agents?limit=2"),
    );
    await step("The first page has the two newest and a cursor", async () => {
      expect(page.status).toBe(200);
      expect(page.data.items.map((item: any) => item.name)).toEqual([
        "third",
        "second",
      ]);
      expect(typeof page.data.nextCursor).toBe("string");
    });
    await step("GET /auth/agents with the cursor", async () => {
      const next = await user.api.get(
        `/auth/agents?limit=2&cursor=${encodeURIComponent(page.data.nextCursor)}`,
      );
      expect(next.data.items.map((item: any) => item.name)).toEqual(["first"]);
      expect(next.data.nextCursor).toBeNull();
    });
    await step("GET /auth/agents with a made-up cursor", async () => {
      const refused = await user.api.get("/auth/agents?cursor=not-a-cursor");
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await turnOff(app);
  },
);

test(
  "with the setting off, users still manage the agents they have",
  {
    tag: ["@agents", "@settings"],
    annotation: about(
      "Turning selfService.agents off makes create, edit and regenerate FEATURE_DISABLED. Listing, reading, disabling, enabling and deleting still work, and the agent's token still trades.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "kept" });
    await step("Turn the setting off", () => turnOff(app));
    const refused: [string, string, unknown?][] = [
      ["POST", "/auth/agents", { name: "new" }],
      ["PATCH", `/auth/agents/${bot.id}`, { name: "renamed" }],
      ["POST", `/auth/agents/${bot.id}/regenerate`],
    ];
    for (const [method, path, body] of refused) {
      await step(`${method} ${path.replace(bot.id, "{id}")} is FEATURE_DISABLED`, async () => {
        const result = await user.api.send(method, path, body ?? {});
        expect(result.status).toBe(403);
        expect(result.code).toBe("FEATURE_DISABLED");
      });
    }
    await step("The token still trades and the agent is unchanged", async () => {
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
      const read = await user.api.get(`/auth/agents/${bot.id}`);
      expect(read.data.name).toBe("kept");
      expect(read.data.lastFour).toBe(bot.token.slice(-4));
    });
    await step("GET list and GET one still answer", async () => {
      expect((await user.api.get("/auth/agents")).data.items).toHaveLength(1);
      expect((await user.api.get(`/auth/agents/${bot.id}`)).status).toBe(200);
    });
    await step("Disable and enable still work", async () => {
      expect((await user.api.post(`/auth/agents/${bot.id}/disable`)).status).toBe(200);
      expect((await user.api.post(`/auth/agents/${bot.id}/enable`)).status).toBe(200);
    });
    await step("DELETE still works", async () => {
      expect((await user.api.delete(`/auth/agents/${bot.id}`)).status).toBe(204);
    });
  },
);

test(
  "the agent routes need a password or code sign-in",
  {
    tag: ["@agents", "@security"],
    annotation: about(
      "No token is 401. A console token, the service key, an agent's access token and an access token traded from a personal token are all refused with 403 AUTHORIZATION_DENIED.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "guarded" });
    const pat = await makePat(app, user);
    const patAccess = await app.newApi("pat-user", await accessFor(app, pat.token));
    const agentAccess = await app.newApi("agent", await accessFor(app, bot.token));
    await step("GET /auth/agents with no credentials", async () => {
      const result = await app.api.get("/auth/agents");
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("POST /auth/agents with no credentials", async () => {
      const result = await app.api.post("/auth/agents", { name: "anon" });
      expect(result.status).toBe(401);
    });
    await step("GET /auth/agents/{id} with a console token", async () => {
      const result = await root.api.get(`/auth/agents/${bot.id}`);
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("POST /auth/agents with the service key", async () => {
      const result = await app.service.post("/auth/agents", { name: "svc" });
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("DELETE /auth/agents/{id} with an agent's access token", async () => {
      const result = await agentAccess.delete(`/auth/agents/${bot.id}`);
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("POST /auth/agents with a personal token's access token", async () => {
      const result = await patAccess.post("/auth/agents", { name: "viapat" });
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("The agent was not touched", async () => {
      expect((await user.api.get(`/auth/agents/${bot.id}`)).status).toBe(200);
    });
    await turnOff(app);
  },
);

test(
  "owner agent changes are audited",
  {
    tag: ["@agents", "@audit"],
    annotation: about(
      "Making, editing, regenerating, disabling, enabling and deleting an agent each leave an audit event with the user as actor and the agent as the resource. No event holds a token.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "audited" });
    await user.api.patch(`/auth/agents/${bot.id}`, { description: "x" }, { record: false });
    const regenerated = await user.api.post(`/auth/agents/${bot.id}/regenerate`, undefined, {
      record: false,
    });
    app.secret(regenerated.data.token);
    await user.api.post(`/auth/agents/${bot.id}/disable`, undefined, { record: false });
    await user.api.post(`/auth/agents/${bot.id}/enable`, undefined, { record: false });
    await user.api.delete(`/auth/agents/${bot.id}`, undefined, { record: false });
    const expected: [string, Record<string, unknown>][] = [
      ["agent.created", { name: "audited" }],
      ["agent.updated", { fields: ["description"] }],
      ["agent.token_regenerated", { name: "audited" }],
      ["agent.disabled", { name: "audited", ownerId: user.id }],
      ["agent.enabled", { name: "audited", ownerId: user.id }],
      ["agent.deleted", { name: "audited", ownerId: user.id }],
    ];
    for (const [action, metadata] of expected) {
      await step(`GET /admin/audit-events?action=${action}`, async () => {
        const events = await auditEvents(root.api, action);
        const event = events.find((item) => item.resourceId === bot.id);
        expect(event, action).toBeDefined();
        expect(event.resourceType).toBe("agent");
        expect(event.metadata).toMatchObject(metadata);
        expect(JSON.stringify(event)).not.toContain(bot.token);
        expect(JSON.stringify(event)).not.toContain(regenerated.data.token);
      });
    }
    await turnOff(app);
  },
);
