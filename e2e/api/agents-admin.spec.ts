import { about, expect, step, test, useServer } from "../harness/index.ts";
import {
  auditEvents,
  makeAgent,
  setUserStatus,
  tradeQuietly,
  turnOff,
  turnOn,
} from "./tokens.support.ts";

const app = useServer();

test(
  "an admin lists every agent, whoever owns it",
  {
    tag: ["@agents", "@admins", "@smoke"],
    annotation: about(
      "GET /admin/agents shows agents owned by users and by admins, newest first, each with its owner's kind and email. The service key may list and read, and a user's token or no token may not.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user("ana");
    const mine = await makeAgent(app, user, { name: "users-bot" });
    const theirs = await makeAgent(app, root, { name: "admins-bot" });
    await step("GET /admin/agents with the console token", async () => {
      const list = await root.api.get("/admin/agents");
      expect(list.status).toBe(200);
      expect(list.message).toBe("AGENTS_FETCHED");
      const names = list.data.items.map((item: any) => item.name);
      expect(names.indexOf("admins-bot")).toBeLessThan(names.indexOf("users-bot"));
      const byName = Object.fromEntries(list.data.items.map((item: any) => [item.name, item]));
      expect(byName["users-bot"].owner).toEqual({
        id: user.id,
        kind: "user",
        email: user.email,
      });
      expect(byName["admins-bot"].owner).toEqual({
        id: root.id,
        kind: "admin",
        email: root.email,
      });
      expect(JSON.stringify(list.body)).not.toContain(mine.token);
      expect(JSON.stringify(list.body)).not.toContain(theirs.token);
    });
    await step("GET /admin/agents with the service key", async () => {
      const list = await app.service.get("/admin/agents");
      expect(list.status).toBe(200);
      expect(list.data.items.map((item: any) => item.id)).toEqual(
        expect.arrayContaining([mine.id, theirs.id]),
      );
    });
    await step("GET /admin/agents with no credentials", async () => {
      const result = await app.api.get("/admin/agents");
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("GET /admin/agents with a user's access token", async () => {
      const result = await user.api.get("/admin/agents");
      expect(result.status).toBe(403);
      expect(result.code).toBe("AUTHORIZATION_DENIED");
    });
    await turnOff(app);
  },
);

test(
  "the agent list filters by owner, status and name, and pages",
  {
    tag: ["@agents", "@admins"],
    annotation: about(
      "owner takes a user or admin ID, status takes active or disabled, search matches part of the name. The filters combine. limit and cursor page through the result, and a bad cursor is REQUEST_INVALID.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const ana = await app.user("ana");
    const leo = await app.user("leo");
    const tag = app.uniq("f");
    const a1 = await makeAgent(app, ana, { name: `${tag}-alpha` });
    const a2 = await makeAgent(app, ana, { name: `${tag}-beta` });
    const l1 = await makeAgent(app, leo, { name: `${tag}-gamma` });
    const r1 = await makeAgent(app, root, { name: `${tag}-delta` });
    await root.api.must("POST", `/admin/agents/${a2.id}/disable`, undefined, {
      record: false,
    });
    const names = (result: { data: { items: any[] } }) =>
      result.data.items.map((item) => item.name).sort();
    await step("GET /admin/agents?owner= a user's ID", async () => {
      const list = await root.api.get(`/admin/agents?owner=${ana.id}`);
      expect(list.status).toBe(200);
      expect(names(list)).toEqual([`${tag}-alpha`, `${tag}-beta`]);
    });
    await step("GET /admin/agents?owner= an admin's ID", async () => {
      const list = await root.api.get(`/admin/agents?owner=${root.id}`);
      expect(names(list)).toContain(`${tag}-delta`);
      expect(list.data.items.every((item: any) => item.owner.kind === "admin")).toBe(true);
    });
    await step("GET /admin/agents?status=disabled", async () => {
      const list = await root.api.get("/admin/agents?status=disabled");
      expect(names(list)).toEqual([`${tag}-beta`]);
    });
    await step("GET /admin/agents?status=active", async () => {
      const list = await root.api.get(`/admin/agents?status=active&search=${tag}`);
      expect(names(list)).toEqual([`${tag}-alpha`, `${tag}-delta`, `${tag}-gamma`]);
    });
    await step("GET /admin/agents?search= part of a name", async () => {
      const list = await root.api.get(`/admin/agents?search=${tag}-gam`);
      expect(names(list)).toEqual([`${tag}-gamma`]);
    });
    await step("GET /admin/agents?search= a name nobody has", async () => {
      const list = await root.api.get("/admin/agents?search=zzz-no-such-agent");
      expect(list.data.items).toEqual([]);
    });
    await step("GET /admin/agents with owner, status and search together", async () => {
      const list = await root.api.get(
        `/admin/agents?owner=${ana.id}&status=active&search=${tag}`,
      );
      expect(names(list)).toEqual([`${tag}-alpha`]);
    });
    await step("GET /admin/agents?status= an unknown status", async () => {
      const refused = await root.api.get("/admin/agents?status=sleeping");
      expect(refused.status).toBe(400);
    });
    await step("limit and cursor walk the whole filtered list", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string =
          `/admin/agents?search=${tag}&limit=3` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
        const page = await root.api.get(query);
        expect(page.status).toBe(200);
        expect(page.data.items.length).toBeLessThanOrEqual(3);
        seen.push(...page.data.items.map((item: any) => item.id));
        cursor = page.data.nextCursor;
        pages += 1;
      } while (cursor && pages < 5);
      expect(pages).toBe(2);
      expect(seen).toEqual([r1.id, l1.id, a2.id, a1.id]);
    });
    await step("GET /admin/agents?cursor= a made-up cursor", async () => {
      const refused = await root.api.get("/admin/agents?cursor=not-a-cursor");
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await turnOff(app);
  },
);

test(
  "an admin makes an agent they own, without the setting or the limit",
  {
    tag: ["@agents", "@admins"],
    annotation: about(
      "POST /admin/agents works while selfService.agents is off and past maxAgentsPerUser, and the agent's owner is the admin. Names and capabilities follow the same rules as for users.",
    ),
  },
  async () => {
    await turnOff(app);
    await app.settings("selfService", { maxAgentsPerUser: 1 });
    const root = await app.root();
    const sam = await app.admin("sam");
    const created = await step("POST /admin/agents with the feature off", () =>
      root.api.post("/admin/agents", {
        name: "invoice-bot",
        description: "Reads invoices",
        capabilities: { invoices: "read" },
      }),
    );
    const token = app.secret(created.data.token as string);
    await step("It answers AGENT_CREATED and the admin owns the agent", async () => {
      expect(created.status).toBe(201);
      expect(created.message).toBe("AGENT_CREATED");
      expect(token).toMatch(/^dga_[A-Za-z0-9_-]{43}$/);
      expect(created.data.agent).toMatchObject({
        name: "invoice-bot",
        description: "Reads invoices",
        owner: { id: root.id, kind: "admin", email: root.email },
        capabilities: { invoices: "read" },
        status: "active",
        lastFour: token.slice(-4),
      });
    });
    await step("A second and a third agent are not held back by the cap of 1", async () => {
      for (const name of ["second", "third"]) {
        const more = await root.api.post("/admin/agents", { name });
        expect(more.status).toBe(201);
        app.secret(more.data.token);
      }
    });
    await step("The same name again is AGENT_NAME_TAKEN", async () => {
      const taken = await root.api.post("/admin/agents", { name: "invoice-bot" });
      expect(taken.status).toBe(409);
      expect(taken.code).toBe("AGENT_NAME_TAKEN");
    });
    await step("Another admin can use the same name", async () => {
      const other = await sam.api.post("/admin/agents", { name: "invoice-bot" });
      expect(other.status).toBe(201);
      app.secret(other.data.token);
      expect(other.data.agent.owner.id).toBe(sam.id);
    });
    await step("A bad name is REQUEST_INVALID", async () => {
      const refused = await root.api.post("/admin/agents", { name: "Bad Name" });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("Bad capabilities are CAPABILITIES_INVALID", async () => {
      const refused = await root.api.post("/admin/agents", {
        name: "nested",
        capabilities: { a: { b: 1 } },
      });
      expect(refused.status).toBe(422);
      expect(refused.code).toBe("CAPABILITIES_INVALID");
    });
    await step("The agent's token trades for an access token owned by the admin", async () => {
      const traded = await app.api.post("/auth/token", { token });
      expect(traded.status).toBe(200);
      const claims = JSON.parse(
        Buffer.from(traded.data.accessToken.split(".")[1], "base64url").toString(),
      );
      expect(claims.owner).toBe(root.id);
      expect(claims.kind).toBe("agent");
    });
    await step("POST /admin/agents with no credentials or a user's token", async () => {
      const user = await app.user();
      expect((await app.api.post("/admin/agents", { name: "anon" })).status).toBe(401);
      const denied = await user.api.post("/admin/agents", { name: "mine" });
      expect(denied.status).toBe(403);
      expect(denied.code).toBe("AUTHORIZATION_DENIED");
    });
    await turnOff(app);
  },
);

test(
  "the service key reads agents and cannot change them",
  {
    tag: ["@agents", "@security"],
    annotation: about(
      "With the service key, GET /admin/agents/{id} works, and every write route answers 403 AUTHORIZATION_DENIED. The agent is untouched afterwards.",
    ),
  },
  async () => {
    await turnOn(app);
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "svc-target" });
    await step("GET /admin/agents/{id} with the service key", async () => {
      const read = await app.service.get(`/admin/agents/${bot.id}`);
      expect(read.status).toBe(200);
      expect(read.message).toBe("AGENT_FETCHED");
      expect(read.data).toEqual(bot.agent);
    });
    const writes: [string, string, unknown?][] = [
      ["POST", "/admin/agents", { name: "svc-new" }],
      ["PATCH", `/admin/agents/${bot.id}`, { description: "changed" }],
      ["POST", `/admin/agents/${bot.id}/regenerate`],
      ["POST", `/admin/agents/${bot.id}/disable`],
      ["POST", `/admin/agents/${bot.id}/enable`],
      ["DELETE", `/admin/agents/${bot.id}`],
    ];
    for (const [method, path, body] of writes) {
      await step(`${method} ${path.replace(bot.id, "{id}")} with the service key`, async () => {
        const result = await app.service.send(method, path, body ?? (method === "DELETE" ? undefined : {}));
        expect(result.status).toBe(403);
        expect(result.code).toBe("AUTHORIZATION_DENIED");
      });
    }
    await step("The agent is unchanged and still trades", async () => {
      const read = await app.service.get(`/admin/agents/${bot.id}`, { record: false });
      expect(read.data).toEqual(bot.agent);
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await turnOff(app);
  },
);

test(
  "only the owning admin edits an agent or regenerates its token",
  {
    tag: ["@agents", "@admins", "@security"],
    annotation: about(
      "PATCH and regenerate on /admin/agents answer 403 AUTHORIZATION_DENIED for any admin who is not the owner, root included, whether the owner is a user or another admin. The owner admin can do both, and regenerating stops the old token.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const ana = await app.admin("ana");
    const sam = await app.admin("sam");
    const user = await app.user();
    const users = await makeAgent(app, user, { name: "users-bot" });
    const anas = await makeAgent(app, ana, { name: "anas-bot", capabilities: { scope: "read" } });
    for (const [who, label, admin] of [
      ["a user's agent", "root", root],
      ["a user's agent", "another admin", sam],
      ["another admin's agent", "root", root],
      ["another admin's agent", "a third admin", sam],
    ] as const) {
      const target = who === "a user's agent" ? users : anas;
      await step(`PATCH ${who} as ${label}`, async () => {
        const denied = await admin.api.patch(`/admin/agents/${target.id}`, {
          name: "hijacked",
        });
        expect(denied.status).toBe(403);
        expect(denied.code).toBe("AUTHORIZATION_DENIED");
      });
      await step(`POST regenerate on ${who} as ${label}`, async () => {
        const denied = await admin.api.post(`/admin/agents/${target.id}/regenerate`);
        expect(denied.status).toBe(403);
        expect(denied.code).toBe("AUTHORIZATION_DENIED");
      });
    }
    await step("Neither agent changed and both tokens still trade", async () => {
      const read = await root.api.get(`/admin/agents/${anas.id}`);
      expect(read.data).toEqual(anas.agent);
      expect((await tradeQuietly(app, anas.token)).status).toBe(200);
      expect((await tradeQuietly(app, users.token)).status).toBe(200);
    });
    await step("PATCH as the owning admin keeps what is left out", async () => {
      const updated = await ana.api.patch(`/admin/agents/${anas.id}`, {
        description: "billing helper",
      });
      expect(updated.status).toBe(200);
      expect(updated.message).toBe("AGENT_UPDATED");
      expect(updated.data).toMatchObject({
        name: "anas-bot",
        description: "billing helper",
        capabilities: { scope: "read" },
      });
    });
    await step("PATCH as the owner replaces capabilities and renames", async () => {
      const updated = await ana.api.patch(`/admin/agents/${anas.id}`, {
        name: "anas-bot-2",
        capabilities: { scope: "billing" },
      });
      expect(updated.data).toMatchObject({
        name: "anas-bot-2",
        capabilities: { scope: "billing" },
      });
    });
    await step("PATCH as the owner with bad input is refused", async () => {
      const name = await ana.api.patch(`/admin/agents/${anas.id}`, { name: "Not OK" });
      expect(name.status).toBe(422);
      const caps = await ana.api.patch(`/admin/agents/${anas.id}`, {
        capabilities: { n: null },
      });
      expect(caps.code).toBe("CAPABILITIES_INVALID");
    });
    await step("POST regenerate as the owner stops the old token", async () => {
      const regenerated = await ana.api.post(`/admin/agents/${anas.id}/regenerate`);
      expect(regenerated.status).toBe(200);
      expect(regenerated.message).toBe("AGENT_TOKEN_REGENERATED");
      const fresh = app.secret(regenerated.data.token as string);
      expect(fresh).not.toBe(anas.token);
      expect((await tradeQuietly(app, anas.token)).code).toBe("TOKEN_INVALID");
      expect((await tradeQuietly(app, fresh)).status).toBe(200);
    });
    await step("PATCH and regenerate of an unknown agent are 404", async () => {
      const patch = await ana.api.patch("/admin/agents/agt_unknown", { description: "x" });
      expect(patch.status).toBe(404);
      const regen = await ana.api.post("/admin/agents/agt_unknown/regenerate", undefined, {
        record: false,
      });
      expect(regen.status).toBe(404);
    });
    await turnOff(app);
  },
);

test(
  "any admin can read, turn off, turn on and delete any agent",
  {
    tag: ["@agents", "@admins"],
    annotation: about(
      "An admin who owns nothing reads a user's agent and turns it off, which refuses its token and shows in the user's own list. Turning it on restores it. Deleting removes it for the user too, and an unknown ID is 404.",
    ),
  },
  async () => {
    await turnOn(app);
    const sam = await app.admin("sam");
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "managed" });
    await step("GET /admin/agents/{id} as an admin who is not the owner", async () => {
      const read = await sam.api.get(`/admin/agents/${bot.id}`);
      expect(read.status).toBe(200);
      expect(read.data).toEqual(bot.agent);
    });
    await step("POST /admin/agents/{id}/disable", async () => {
      const off = await sam.api.post(`/admin/agents/${bot.id}/disable`);
      expect(off.status).toBe(200);
      expect(off.message).toBe("AGENT_DISABLED");
      expect(off.data.status).toBe("disabled");
    });
    await step("The token is refused and the user sees it disabled", async () => {
      const refused = await app.api.post("/auth/token", { token: bot.token });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
      const own = await user.api.get(`/auth/agents/${bot.id}`);
      expect(own.data.status).toBe("disabled");
    });
    await step("POST /admin/agents/{id}/enable", async () => {
      const on = await sam.api.post(`/admin/agents/${bot.id}/enable`);
      expect(on.status).toBe(200);
      expect(on.message).toBe("AGENT_ENABLED");
      expect(on.data.status).toBe("active");
      expect((await tradeQuietly(app, bot.token)).status).toBe(200);
    });
    await step("DELETE /admin/agents/{id}", async () => {
      const deleted = await sam.api.delete(`/admin/agents/${bot.id}`);
      expect(deleted.status).toBe(204);
    });
    await step("The agent is gone for the admin and for the user", async () => {
      const read = await sam.api.get(`/admin/agents/${bot.id}`);
      expect(read.status).toBe(404);
      expect(read.code).toBe("NOT_FOUND");
      expect((await user.api.get(`/auth/agents/${bot.id}`)).status).toBe(404);
      expect((await tradeQuietly(app, bot.token)).code).toBe("TOKEN_INVALID");
    });
    await step("Disable, enable and delete of an unknown agent are 404", async () => {
      for (const [method, path] of [
        ["POST", "/admin/agents/agt_unknown/disable"],
        ["POST", "/admin/agents/agt_unknown/enable"],
        ["DELETE", "/admin/agents/agt_unknown"],
        ["GET", "/admin/agents/agt_unknown"],
      ] as const) {
        const result = await sam.api.send(method, path, method === "POST" ? {} : undefined, {
          record: false,
        });
        expect(result.status, `${method} ${path}`).toBe(404);
        expect(result.code).toBe("NOT_FOUND");
      }
    });
    await step("The routes refuse a user's token", async () => {
      const own = await makeAgent(app, user, { name: "again" });
      const denied = await user.api.post(`/admin/agents/${own.id}/disable`);
      expect(denied.status).toBe(403);
      expect(denied.code).toBe("AUTHORIZATION_DENIED");
      const deleted = await user.api.delete(`/admin/agents/${own.id}`);
      expect(deleted.status).toBe(403);
    });
    await turnOff(app);
  },
);

test(
  "an agent follows its owner when the owner is disabled or deleted",
  {
    tag: ["@agents", "@users"],
    annotation: about(
      "Disabling a user or an admin makes their agents' tokens AGENT_DISABLED until the owner is enabled again. Deleting the owner deletes the agents, so the token is TOKEN_INVALID and the admin list no longer shows them.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user();
    const userBot = await makeAgent(app, user, { name: "users-bot" });
    await step("Disable the user: the agent is AGENT_DISABLED", async () => {
      await setUserStatus(app, user.id, false);
      const refused = await app.api.post("/auth/token", { token: userBot.token });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
    });
    await step("Enable the user: the same token works", async () => {
      await setUserStatus(app, user.id, true);
      expect((await tradeQuietly(app, userBot.token)).status).toBe(200);
    });
    await step("Delete the user: the agent goes with them", async () => {
      const deleted = await app.service.delete(`/admin/users/${user.id}`, undefined, {
        record: false,
      });
      expect(deleted.status).toBe(204);
      expect((await tradeQuietly(app, userBot.token)).code).toBe("TOKEN_INVALID");
      const read = await root.api.get(`/admin/agents/${userBot.id}`);
      expect(read.status).toBe(404);
      const list = await root.api.get(`/admin/agents?owner=${user.id}`);
      expect(list.data.items).toEqual([]);
    });
    const sam = await app.admin("sam");
    const adminBot = await makeAgent(app, sam, { name: "sams-bot" });
    await step("Disable the admin: their agent is AGENT_DISABLED", async () => {
      const off = await root.api.post(`/admin/admins/${sam.id}/disable`, undefined, {
        record: false,
      });
      expect(off.status).toBe(200);
      const refused = await app.api.post("/auth/token", { token: adminBot.token });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AGENT_DISABLED");
    });
    await step("Enable the admin: the same token works", async () => {
      const on = await root.api.post(`/admin/admins/${sam.id}/enable`, undefined, {
        record: false,
      });
      expect(on.status).toBe(200);
      expect((await tradeQuietly(app, adminBot.token)).status).toBe(200);
    });
    await step("Delete the admin: the agent goes with them", async () => {
      const deleted = await root.api.delete(`/admin/admins/${sam.id}`, undefined, {
        record: false,
      });
      expect(deleted.status).toBe(204);
      expect((await tradeQuietly(app, adminBot.token)).code).toBe("TOKEN_INVALID");
      expect((await root.api.get(`/admin/agents/${adminBot.id}`)).status).toBe(404);
    });
    await turnOff(app);
  },
);

test(
  "admin changes to an agent are audited with the admin as actor",
  {
    tag: ["@agents", "@audit"],
    annotation: about(
      "When an admin turns off or deletes a user's agent, the audit event names the agent and its owner. A rejected dga_ value is recorded as agent.token_rejected with only its last four characters, and a rejected trade for a value with no prefix is recorded without any of it. Successful trades are not recorded.",
    ),
  },
  async () => {
    await turnOn(app);
    const root = await app.root();
    const user = await app.user();
    const bot = await makeAgent(app, user, { name: "watched" });
    await step("Turn the agent off, on, and delete it as root", async () => {
      await root.api.post(`/admin/agents/${bot.id}/disable`);
      await root.api.post(`/admin/agents/${bot.id}/enable`);
      await root.api.delete(`/admin/agents/${bot.id}`);
    });
    for (const action of ["agent.disabled", "agent.enabled", "agent.deleted"]) {
      await step(`GET /admin/audit-events?action=${action}`, async () => {
        const events = await auditEvents(root.api, action);
        const event = events.find((item) => item.resourceId === bot.id);
        expect(event, action).toBeDefined();
        expect(event.actorType).toBe("root");
        expect(event.resourceType).toBe("agent");
        expect(event.metadata).toMatchObject({ name: "watched", ownerId: user.id });
      });
    }
    await step("A rejected dga_ value is recorded with its last four characters", async () => {
      const fake = `dga_${"y".repeat(39)}cd34`;
      const refused = await app.api.post("/auth/token", { token: fake });
      expect(refused.code).toBe("TOKEN_INVALID");
      const events = await auditEvents(root.api, "agent.token_rejected");
      const event = events[0];
      expect(event.actorType).toBe("anonymous");
      expect(event.metadata).toEqual({ kind: "agent", lastFour: "cd34" });
      expect(JSON.stringify(event)).not.toContain("yyyyyyyy");
    });
    await step("A successful trade leaves no audit event", async () => {
      const fresh = await makeAgent(app, user, { name: "quiet" });
      const after = (await root.api.get("/admin/audit-events?limit=200", { record: false })).data
        .items;
      const created = after.filter((item: any) => item.resourceId === fresh.id);
      expect(created.map((item: any) => item.action)).toEqual(["agent.created"]);
    });
    await turnOff(app);
  },
);
