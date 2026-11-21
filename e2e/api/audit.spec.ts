import { PASSWORD, about, expect, step, test, useServer } from "../harness/index.ts";
import { query } from "../harness/server.ts";
import { eventsOf } from "./admin.support.ts";

const app = useServer();

const HEX = /^[0-9a-f]{64}$/;

test(
  "an event has the documented fields and links to the one before it",
  {
    tag: ["@audit", "@smoke"],
    annotation: about(
      "Creating a user through the service key writes user.created. The record names the actor, the resource, the client address and its place in the hash chain, and its prevHash is the recordHash of the record before it.",
    ),
  },
  async () => {
    const email = app.email("audited");
    const created = await app.service.post("/admin/users", { email });
    const page = await step("GET /admin/audit-events as a backend", () =>
      app.service.get("/admin/audit-events"),
    );
    await step("It answers 200 AUDIT_EVENTS_FETCHED with items and a cursor", async () => {
      expect(page.status).toBe(200);
      expect(page.message).toBe("AUDIT_EVENTS_FETCHED");
      expect(Array.isArray(page.data.items)).toBe(true);
      expect(page.data).toHaveProperty("nextCursor");
    });
    const [event, before] = page.data.items;
    await step("The newest record is that user.created, with every field", async () => {
      expect(event).toMatchObject({
        actorType: "service",
        actorId: null,
        actorLabel: "service",
        action: "user.created",
        resourceType: "user",
        resourceId: created.data.id,
        ipAddress: "127.0.0.1",
        metadata: { email },
      });
      expect(event.id).toMatch(/^aud_/);
      expect(Date.parse(event.createdAt)).not.toBeNaN();
      expect(event.seq).toEqual(expect.any(Number));
      expect(event.prevHash).toMatch(HEX);
      expect(event.recordHash).toMatch(HEX);
    });
    await step("Its prevHash is the recordHash of the record before it", async () => {
      expect(event.seq).toBe(before.seq + 1);
      expect(event.prevHash).toBe(before.recordHash);
    });
    await step("Events come newest first, with rising sequence numbers going back", async () => {
      const seqs: number[] = page.data.items.map((item: any) => item.seq);
      expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
      const times: string[] = page.data.items.map((item: any) => item.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
    });
    await step("The first record of all is the instance setup", async () => {
      const all = await app.service.get("/admin/audit-events?action=instance.initialized");
      expect(all.data.items).toHaveLength(1);
      expect(all.data.items[0]).toMatchObject({
        actorType: "system",
        actorLabel: "setup",
        seq: 1,
      });
    });
  },
);

test(
  "a user created by the service key, by root and by an admin carry different actors",
  {
    tag: ["@audit", "@users"],
    annotation: about(
      "user.created names the service key as service, root by its email with type root, and a regular admin with type admin, each with their own actor id.",
    ),
  },
  async () => {
    const root = await app.root();
    const sam = await app.admin("sam");
    const bySvc = await app.service.post("/admin/users", { email: app.email("svc") });
    const byRoot = await root.api.post("/admin/users", { email: app.email("byroot") });
    const bySam = await sam.api.post("/admin/users", { email: app.email("bysam") });
    const events = await step("GET /admin/audit-events?action=user.created", () =>
      app.service.get("/admin/audit-events?action=user.created"),
    );
    const find = (id: string) => events.data.items.find((item: any) => item.resourceId === id);
    await step("The service key's event", async () => {
      expect(find(bySvc.data.id)).toMatchObject({
        actorType: "service",
        actorId: null,
        actorLabel: "service",
      });
    });
    await step("Root's event", async () => {
      expect(find(byRoot.data.id)).toMatchObject({
        actorType: "root",
        actorId: root.id,
        actorLabel: root.email,
      });
    });
    await step("The admin's event", async () => {
      expect(find(bySam.data.id)).toMatchObject({
        actorType: "admin",
        actorId: sam.id,
        actorLabel: sam.email,
      });
    });
    await step("Filtering by each actor finds only its events", async () => {
      const own = await app.service.get(`/admin/audit-events?actor=${sam.id}&action=user.created`);
      expect(own.data.items.map((item: any) => item.resourceId)).toEqual([bySam.data.id]);
    });
  },
);

test(
  "sign-in, a failed sign-in and sign-out are recorded with the client address",
  {
    tag: ["@audit", "@auth"],
    annotation: about(
      "user.signed_in carries the method and session id, user.sign_in_failed the reason, and user.signed_out the session. The address is the one the request came from, or the visitor address a backend passes on.",
    ),
  },
  async () => {
    const user = await app.user("trail");
    const api = await app.newApi("trail");
    const signedIn = await api.signIn("/auth/login", user.email, PASSWORD);
    await step("The sign-in is user.signed_in with its session", async () => {
      const [event] = await eventsOf(app.service, "user.signed_in", `&actor=${user.id}`);
      expect(event.actorType).toBe("user");
      expect(event).toMatchObject({
        actorId: user.id,
        actorLabel: user.email,
        resourceType: "user",
        resourceId: user.id,
        ipAddress: "127.0.0.1",
      });
      expect(event.metadata.method).toBe("password");
      const sessions = await app.service.get(`/admin/users/${user.id}/sessions`);
      expect(sessions.data.map((s: any) => s.id)).toContain(event.metadata.sessionId);
      expect(signedIn.status).toBe(200);
    });
    await step("A wrong password is user.sign_in_failed", async () => {
      const failed = await app.newApi("wrong");
      expect((await failed.signIn("/auth/login", user.email, "wrong password")).status).toBe(401);
      const [event] = await eventsOf(app.service, "user.sign_in_failed");
      expect(event).toMatchObject({
        actorLabel: user.email,
        metadata: { reason: "password", locked: false },
      });
    });
    await step("A failed sign-in for an unknown email is not recorded", async () => {
      const before = (await eventsOf(app.service, "user.sign_in_failed")).length;
      await app.api.post("/auth/login", { email: app.email("ghost"), password: "wrong password" });
      expect(await eventsOf(app.service, "user.sign_in_failed")).toHaveLength(before);
    });
    await step("The fifth wrong password in a row is recorded as locking the account", async () => {
      const locker = await app.user("locker");
      const failed = await app.newApi("locker");
      for (let attempt = 0; attempt < 5; attempt++) {
        await failed.signIn("/auth/login", locker.email, "wrong password");
      }
      const events = await eventsOf(app.service, "user.sign_in_failed", `&actor=${locker.email}`);
      expect(events).toHaveLength(5);
      expect(events[0].metadata).toMatchObject({ locked: true });
      expect(events[4].metadata).toMatchObject({ locked: false });
    });
    await step("Signing out is user.signed_out", async () => {
      await api.post("/auth/logout", {});
      const [event] = await eventsOf(app.service, "user.signed_out", `&actor=${user.id}`);
      expect(event.metadata.allSessions).toBe(false);
    });
    await step("A backend passing on a visitor address gets it recorded", async () => {
      const visitor = await app.newApi("visitor");
      const result = await visitor.signIn("/auth/login", user.email, PASSWORD, {
        headers: {
          "X-Dopgate-Backend-Key": app.serviceKey,
          "X-Dopgate-Client-IP": "203.0.113.77",
          "X-Dopgate-Client-Agent": "Visitor Browser/1.0",
        },
      });
      expect(result.status).toBe(200);
      const [event] = await eventsOf(app.service, "user.signed_in", `&actor=${user.id}`);
      expect(event.ipAddress).toBe("203.0.113.77");
      const sessions = await app.service.get(`/admin/users/${user.id}/sessions`);
      expect(sessions.data.find((s: any) => s.id === event.metadata.sessionId)).toMatchObject({
        ipAddress: "203.0.113.77",
        userAgent: "Visitor Browser/1.0",
      });
    });
  },
);

test(
  "an admin's own sign-in leaves admin.signed_in with the role as the actor type",
  {
    tag: ["@audit", "@admins"],
    annotation: about(
      "Root and a regular admin signing in to the console are recorded as admin.signed_in, typed root or admin.",
    ),
  },
  async () => {
    const sam = await app.admin("sam");
    const [event] = await step("GET /admin/audit-events?action=admin.signed_in", async () =>
      eventsOf(app.service, "admin.signed_in", `&actor=${sam.id}`),
    );
    await step("The event names the admin and the method", async () => {
      expect(event).toMatchObject({
        actorType: "admin",
        actorId: sam.id,
        actorLabel: sam.email,
        resourceType: "admin",
        resourceId: sam.id,
      });
      expect(event.metadata.method).toBe("password");
    });
    await step("The creation of that admin is admin.created by root", async () => {
      const created = await eventsOf(app.service, "admin.created");
      const event = created.find((item) => item.resourceId === sam.id);
      expect(event).toMatchObject({ actorType: "root", metadata: { email: sam.email } });
    });
  },
);

test(
  "the audit list filters by action and by actor",
  {
    tag: "@audit",
    annotation: about(
      "action matches one action name exactly. actor matches an ID or a label such as an email or service. Both together narrow further, and an unknown value gives an empty list.",
    ),
  },
  async () => {
    const one = await app.user("filter-one");
    const two = await app.user("filter-two");
    await app.service.patch(`/admin/users/${one.id}`, { displayName: "One" });
    await app.service.patch(`/admin/users/${two.id}`, { displayName: "Two" });
    await app.service.post(`/admin/users/${one.id}/disable`);
    await step("action=user.updated lists only those events", async () => {
      const events = await eventsOf(app.service, "user.updated");
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.every((event) => event.action === "user.updated")).toBe(true);
      expect(events.map((event) => event.resourceId)).toEqual(
        expect.arrayContaining([one.id, two.id]),
      );
    });
    await step("A prefix of an action is not a match", async () => {
      const page = await app.service.get("/admin/audit-events?action=user");
      expect(page.data.items).toEqual([]);
    });
    await step("actor=service lists what the backend did", async () => {
      const page = await app.service.get("/admin/audit-events?actor=service&limit=200");
      expect(page.data.items.length).toBeGreaterThan(0);
      expect(page.data.items.every((event: any) => event.actorLabel === "service")).toBe(true);
    });
    await step("actor with a user id lists that user's own events", async () => {
      const page = await app.service.get(`/admin/audit-events?actor=${one.id}`);
      expect(page.data.items.map((event: any) => event.action)).toEqual(["user.signed_in"]);
    });
    await step("actor with an email works the same way", async () => {
      const page = await app.service.get(
        `/admin/audit-events?actor=${encodeURIComponent(one.email)}`,
      );
      expect(page.data.items.map((event: any) => event.action)).toEqual(["user.signed_in"]);
    });
    await step("action and actor together narrow the list", async () => {
      const page = await app.service.get(
        `/admin/audit-events?action=user.disabled&actor=service&limit=200`,
      );
      expect(page.data.items.map((event: any) => event.resourceId)).toEqual([one.id]);
      const none = await app.service.get(
        `/admin/audit-events?action=user.disabled&actor=${two.id}`,
      );
      expect(none.data.items).toEqual([]);
    });
    await step("An unknown action or actor gives an empty page", async () => {
      const page = await app.service.get("/admin/audit-events?action=no.such.action");
      expect(page.status).toBe(200);
      expect(page.data).toEqual({ items: [], nextCursor: null });
      const other = await app.service.get("/admin/audit-events?actor=nobody%40nowhere.test");
      expect(other.data.items).toEqual([]);
    });
  },
);

test(
  "paging with limit and cursor walks every event once",
  {
    tag: "@audit",
    annotation: about(
      "Passing nextCursor back as cursor returns older events with no repeats and no gaps until nextCursor is null. limit is clamped to 1 to 200 and a forged cursor is REQUEST_INVALID.",
    ),
  },
  async () => {
    for (let index = 0; index < 4; index++) {
      await app.service.post("/admin/users", { email: app.email("page") });
    }
    const everything = await step("GET /admin/audit-events with limit=200", async () => {
      const page = await app.service.get("/admin/audit-events?limit=200");
      expect(page.data.nextCursor).toBeNull();
      return page.data.items.map((event: any) => event.id) as string[];
    });
    await step("Pages of 3 return the same events in the same order", async () => {
      const ids: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const next: any = await app.service.get(
          `/admin/audit-events?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        expect(next.status).toBe(200);
        expect(next.data.items.length).toBeLessThanOrEqual(3);
        ids.push(...next.data.items.map((event: any) => event.id));
        cursor = next.data.nextCursor;
        pages += 1;
      } while (cursor && pages < 100);
      expect(ids).toEqual(everything);
      expect(pages).toBe(Math.ceil(everything.length / 3));
    });
    await step("limit=1 gives one event and a cursor", async () => {
      const page = await app.service.get("/admin/audit-events?limit=1");
      expect(page.data.items).toHaveLength(1);
      expect(page.data.nextCursor).toEqual(expect.any(String));
      const second = await app.service.get(
        `/admin/audit-events?limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`,
      );
      expect(second.data.items[0].id).toBe(everything[1]);
    });
    await step("limit=0 is treated as 1 and a big limit as at most 200", async () => {
      expect((await app.service.get("/admin/audit-events?limit=0")).data.items).toHaveLength(1);
      const big = await app.service.get("/admin/audit-events?limit=100000");
      expect(big.status).toBe(200);
      expect(big.data.items.length).toBeLessThanOrEqual(200);
    });
    await step("Filters and cursors work together", async () => {
      const first = await app.service.get("/admin/audit-events?action=user.created&limit=2");
      const second = await app.service.get(
        `/admin/audit-events?action=user.created&limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`,
      );
      const ids = [...first.data.items, ...second.data.items].map((event: any) => event.id);
      expect(new Set(ids).size).toBe(4);
      expect(second.data.items.every((event: any) => event.action === "user.created")).toBe(true);
    });
    await step("Forged cursors are 400 REQUEST_INVALID", async () => {
      const text = (value: string) => Buffer.from(value).toString("base64url");
      for (const cursor of ["not a cursor", "zzz", text("no-separator")]) {
        const page = await app.service.get(`/admin/audit-events?cursor=${encodeURIComponent(cursor)}`);
        expect(page.status, cursor).toBe(400);
        expect(page.code, cursor).toBe("REQUEST_INVALID");
      }
    });
  },
);

test(
  "verify reports an intact chain with its head",
  {
    tag: ["@audit", "@smoke"],
    annotation: about(
      "GET /admin/audit-events/verify recomputes the hash chain. It answers ok true with the number of records, the head's position and hash, and no break, and the head matches the newest event.",
    ),
  },
  async () => {
    await app.service.post("/admin/users", { email: app.email("verify") });
    const report = await step("GET /admin/audit-events/verify as a backend", () =>
      app.service.get("/admin/audit-events/verify"),
    );
    await step("It answers 200 AUDIT_CHAIN_VERIFIED with ok true", async () => {
      expect(report.status).toBe(200);
      expect(report.message).toBe("AUDIT_CHAIN_VERIFIED");
      expect(report.data).toMatchObject({
        ok: true,
        legacy: 0,
        unsequenced: 0,
        prunedSeq: null,
        broken: null,
        anchor: null,
      });
      expect(report.data.records).toBeGreaterThan(5);
    });
    await step("The head is the newest event and records counts them all", async () => {
      const [newest] = (await app.service.get("/admin/audit-events?limit=1")).data.items;
      expect(report.data.headSeq).toBeGreaterThanOrEqual(newest.seq);
      expect(report.data.headHash).toMatch(HEX);
      expect(report.data.records).toBe(report.data.headSeq);
    });
    await step("The head moves when something new is recorded", async () => {
      await app.service.post("/admin/users", { email: app.email("verify") });
      const later = await app.service.get("/admin/audit-events/verify");
      expect(later.data.ok).toBe(true);
      expect(later.data.headSeq).toBeGreaterThan(report.data.headSeq);
      expect(later.data.headHash).not.toBe(report.data.headHash);
    });
    await step("Root can verify as well", async () => {
      const root = await app.root();
      const asRoot = await root.api.get("/admin/audit-events/verify");
      expect(asRoot.data.ok).toBe(true);
    });
  },
);

test(
  "an anchor from an earlier head still matches, and half an anchor is refused",
  {
    tag: ["@audit", "@security"],
    annotation: about(
      "Passing anchorSeq and anchorHash from an earlier report gives anchor.status matched. A wrong hash is a mismatch and makes ok false, a position beyond the log is missing, and one parameter without the other is REQUEST_INVALID.",
    ),
  },
  async () => {
    const head = (await app.service.get("/admin/audit-events/verify")).data;
    await app.service.post("/admin/users", { email: app.email("anchor") });
    await step("The earlier head is matched after new events", async () => {
      const report = await app.service.get(
        `/admin/audit-events/verify?anchorSeq=${head.headSeq}&anchorHash=${head.headHash}`,
      );
      expect(report.status).toBe(200);
      expect(report.data.ok).toBe(true);
      expect(report.data.anchor).toEqual({ seq: head.headSeq, status: "matched" });
      expect(report.data.headSeq).toBeGreaterThan(head.headSeq);
    });
    await step("A wrong hash is a mismatch and ok is false", async () => {
      const report = await app.service.get(
        `/admin/audit-events/verify?anchorSeq=${head.headSeq}&anchorHash=${"0".repeat(64)}`,
      );
      expect(report.status).toBe(200);
      expect(report.data.ok).toBe(false);
      expect(report.data.anchor).toEqual({ seq: head.headSeq, status: "mismatch" });
      expect(report.data.broken).toBeNull();
    });
    await step("A position beyond the log is missing and ok is false", async () => {
      const report = await app.service.get(
        `/admin/audit-events/verify?anchorSeq=${head.headSeq + 1000}&anchorHash=${head.headHash}`,
      );
      expect(report.data.ok).toBe(false);
      expect(report.data.anchor.status).toBe("missing");
    });
    await step("anchorSeq without anchorHash is 400 REQUEST_INVALID", async () => {
      const refused = await app.service.get(`/admin/audit-events/verify?anchorSeq=${head.headSeq}`);
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("anchorHash without anchorSeq is 400 REQUEST_INVALID", async () => {
      const refused = await app.service.get(`/admin/audit-events/verify?anchorHash=${head.headHash}`);
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
    await step("A position of 0 or a blank hash is 400 REQUEST_INVALID", async () => {
      for (const params of [
        `anchorSeq=0&anchorHash=${head.headHash}`,
        `anchorSeq=-4&anchorHash=${head.headHash}`,
        `anchorSeq=${head.headSeq}&anchorHash=`,
      ]) {
        const refused = await app.service.get(`/admin/audit-events/verify?${params}`);
        expect(refused.status, params).toBe(400);
        expect(refused.code, params).toBe("REQUEST_INVALID");
      }
    });
    await step("A position that isn't a number is 400 REQUEST_INVALID", async () => {
      const refused = await app.service.get(
        `/admin/audit-events/verify?anchorSeq=abc&anchorHash=${head.headHash}`,
      );
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("REQUEST_INVALID");
    });
  },
);

test(
  "only admins and the service key read the audit log",
  {
    tag: ["@audit", "@security"],
    annotation: about(
      "No token is 401 and a user's token is 403, on both the list and the verify route. An admin who isn't root can read.",
    ),
  },
  async () => {
    const user = await app.user("curious");
    await step("Without a token both routes are 401", async () => {
      for (const path of ["/admin/audit-events", "/admin/audit-events/verify"]) {
        const result = await app.api.get(path);
        expect(result.status, path).toBe(401);
        expect(result.code, path).toBe("AUTHENTICATION_REQUIRED");
      }
    });
    await step("With a user's token both routes are 403", async () => {
      for (const path of ["/admin/audit-events", "/admin/audit-events/verify"]) {
        const result = await user.api.get(path);
        expect(result.status, path).toBe(403);
        expect(result.code, path).toBe("AUTHORIZATION_DENIED");
      }
    });
    await step("An admin who isn't root reads both", async () => {
      const sam = await app.admin("reader");
      expect((await sam.api.get("/admin/audit-events")).status).toBe(200);
      expect((await sam.api.get("/admin/audit-events/verify")).data.ok).toBe(true);
    });
  },
);

// Last in the file: it damages the chain on purpose.
test(
  "a changed record is found by verify, with the position where the chain breaks",
  {
    tag: ["@audit", "@security"],
    annotation: about(
      "Someone with database access removes the trigger that protects sealed records and rewrites one. Verify answers ok false, counts the records before it, and names that record's position, id and the reason. An anchor taken earlier does not hide it.",
    ),
  },
  async () => {
    const user = await app.user("victim");
    await app.service.patch(`/admin/users/${user.id}`, { displayName: "Original" });
    await app.service.post("/admin/users", { email: app.email("after") });
    const before = (await app.service.get("/admin/audit-events/verify")).data;
    expect(before.ok).toBe(true);
    const [target] = await eventsOf(app.service, "user.updated");
    await step("Without tampering the record's seq is inside the chain", async () => {
      expect(target.seq).toBeGreaterThan(1);
      expect(target.seq).toBeLessThan(before.headSeq);
    });
    await step("The database refuses a plain UPDATE of a sealed record", async () => {
      await expect(
        query(app.server.schema, "UPDATE audit_events SET action = $1 WHERE id = $2", [
          "user.erased",
          target.id,
        ]),
      ).rejects.toThrow(/immutable/);
    });
    await step("Drop the guard and rewrite the record's action", async () => {
      await query(app.server.schema, "DROP TRIGGER audit_events_sealed_immutable ON audit_events");
      await query(app.server.schema, "UPDATE audit_events SET action = $1 WHERE id = $2", [
        "user.erased",
        target.id,
      ]);
    });
    const report = await step("GET /admin/audit-events/verify", () =>
      app.service.get("/admin/audit-events/verify"),
    );
    await step("It answers ok false and names the broken record", async () => {
      expect(report.status).toBe(200);
      expect(report.data.ok).toBe(false);
      expect(report.data.broken).toEqual({
        seq: target.seq,
        id: target.id,
        reason: "record hash does not match its contents",
      });
      expect(report.data.records).toBe(target.seq - 1);
      expect(report.data.headSeq).toBe(target.seq - 1);
    });
    await step("An anchor from before the change doesn't hide it", async () => {
      const anchored = await app.service.get(
        `/admin/audit-events/verify?anchorSeq=${before.headSeq}&anchorHash=${before.headHash}`,
      );
      expect(anchored.data.ok).toBe(false);
      expect(anchored.data.broken.seq).toBe(target.seq);
    });
    await step("The list still reads, and shows the rewritten action", async () => {
      const events = await eventsOf(app.service, "user.erased");
      expect(events.map((event) => event.id)).toEqual([target.id]);
    });
    await step("Deleting a record in the middle is a sequence gap", async () => {
      const [victim] = await query<{ id: string; seq: string }>(
        app.server.schema,
        "SELECT id, seq FROM audit_events WHERE seq = $1",
        [2],
      );
      await query(app.server.schema, "DELETE FROM audit_events WHERE id = $1", [victim!.id]);
      const gap = await app.service.get("/admin/audit-events/verify");
      expect(gap.data.ok).toBe(false);
      expect(gap.data.broken.seq).toBeLessThanOrEqual(3);
    });
  },
);
