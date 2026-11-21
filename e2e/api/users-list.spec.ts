import { about, expect, step, test, useServer } from "../harness/index.ts";

const app = useServer();

type Seeded = { id: string; email: string; displayName: string };

// Seven users made once, oldest first, with names that searches can tell apart.
let seeded: Promise<{ tag: string; users: Seeded[] }> | undefined;
function seed() {
  seeded ??= (async () => {
    const tag = app.uniq("lst").replace("-", "");
    const names = [
      ["alpha", "Zed Alpha"],
      ["bravo", "Bravo Rivera"],
      ["charlie", `Charlie ${tag}`],
      ["delta", "Delta Rivera"],
      ["echo", "Echo Quiet"],
      ["foxtrot", "Foxtrot Quiet"],
      ["golf", "Golf Rivera"],
    ] as const;
    const users: Seeded[] = [];
    for (const [name, displayName] of names) {
      const email = `${name}.${tag}@dopbase.com`;
      const created = await app.service.post(
        "/admin/users",
        { email, password: "correct horse battery", displayName, emailVerified: true },
        { record: false },
      );
      users.push({ id: created.data.id, email, displayName });
    }
    return { tag, users };
  })();
  return seeded;
}

async function allPages(path: string, limit: number): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query: string = `${path}${path.includes("?") ? "&" : "?"}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await app.service.get(query);
    expect(page.status).toBe(200);
    expect(page.data.items.length).toBeLessThanOrEqual(limit);
    ids.push(...page.data.items.map((user: any) => user.id));
    cursor = page.data.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(50);
  } while (cursor);
  return { ids, pages };
}

test(
  "the list shows the newest user first, with the admin view of each",
  {
    tag: ["@users", "@smoke"],
    annotation: about(
      "GET /admin/users answers USERS_FETCHED with items and a nextCursor. Users come newest first and each carries privateMetadata and lockedUntil.",
    ),
  },
  async () => {
    const { users } = await seed();
    const page = await step("GET /admin/users as a backend", () =>
      app.service.get("/admin/users"),
    );
    await step("It answers 200 USERS_FETCHED with items and a null cursor", async () => {
      expect(page.status).toBe(200);
      expect(page.message).toBe("USERS_FETCHED");
      expect(page.data.nextCursor).toBeNull();
      expect(Array.isArray(page.data.items)).toBe(true);
    });
    await step("The seven users are there, newest first", async () => {
      const ids: string[] = page.data.items.map((user: any) => user.id);
      expect(ids.slice(0, users.length)).toEqual(users.map((user) => user.id).reverse());
      const times: string[] = page.data.items.map((user: any) => user.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
    });
    await step("Each item has the admin fields", async () => {
      for (const item of page.data.items) {
        expect(item).toHaveProperty("privateMetadata");
        expect(item).toHaveProperty("lockedUntil");
        expect(item).toHaveProperty("publicMetadata");
        expect(item.id).toMatch(/^usr_/);
      }
    });
  },
);

test(
  "search matches part of an email or a display name",
  {
    tag: "@users",
    annotation: about(
      "search is a case-insensitive substring match on the email and on the display name. A blank search lists everyone, and a search with no match answers an empty list.",
    ),
  },
  async () => {
    const { tag, users } = await seed();
    const find = async (search: string) =>
      (await app.service.get(`/admin/users?search=${encodeURIComponent(search)}`)).data.items.map(
        (user: any) => user.id,
      );
    await step("Part of an email finds that user", async () => {
      expect(await find(`delta.${tag}`)).toEqual([users[3]!.id]);
      expect(await find(`ECHO.${tag.toUpperCase()}`)).toEqual([users[4]!.id]);
    });
    await step("Part of a display name finds every user who has it", async () => {
      const ids = await find("rivera");
      expect(ids).toEqual([users[6]!.id, users[3]!.id, users[1]!.id]);
    });
    await step("A display name can hold the tag, too", async () => {
      expect(await find(`Charlie ${tag}`)).toEqual([users[2]!.id]);
    });
    await step("The domain part matches every seeded user", async () => {
      const ids = await find(`.${tag}@`);
      expect(ids).toEqual(users.map((user) => user.id).reverse());
    });
    await step("A search with no match is an empty list", async () => {
      const page = await app.service.get("/admin/users?search=nobody-has-this-name-zz9");
      expect(page.status).toBe(200);
      expect(page.data).toEqual({ items: [], nextCursor: null });
    });
    await step("A blank search lists everyone", async () => {
      const blank = await app.service.get("/admin/users?search=%20%20");
      const all = await app.service.get("/admin/users");
      expect(blank.data.items.map((user: any) => user.id)).toEqual(
        all.data.items.map((user: any) => user.id),
      );
    });
    await step("Search and paging work together", async () => {
      const { ids, pages } = await allPages(`/admin/users?search=Rivera`, 2);
      expect(ids).toEqual([users[6]!.id, users[3]!.id, users[1]!.id]);
      expect(pages).toBe(2);
    });
  },
);

test(
  "the email filter matches one whole address and ignores case",
  {
    tag: "@users",
    annotation: about(
      "email returns the user with exactly that address, in any letter case. A part of an address finds nobody, which is how it differs from search. A value that isn't an email is EMAIL_INVALID.",
    ),
  },
  async () => {
    const { users } = await seed();
    const target = users[1]!;
    await step("GET /admin/users?email= finds exactly one user", async () => {
      const page = await app.service.get(`/admin/users?email=${encodeURIComponent(target.email)}`);
      expect(page.status).toBe(200);
      expect(page.data.items.map((user: any) => user.id)).toEqual([target.id]);
    });
    await step("Capital letters make no difference", async () => {
      const page = await app.service.get(
        `/admin/users?email=${encodeURIComponent(target.email.toUpperCase())}`,
      );
      expect(page.data.items.map((user: any) => user.id)).toEqual([target.id]);
    });
    await step("A longer address that contains it is not a match", async () => {
      const page = await app.service.get(
        `/admin/users?email=${encodeURIComponent(`x${target.email}`)}`,
      );
      expect(page.data.items).toEqual([]);
      const search = await app.service.get(`/admin/users?search=${encodeURIComponent(target.email)}`);
      expect(search.data.items).toHaveLength(1);
    });
    await step("An unknown address is an empty list", async () => {
      const page = await app.service.get("/admin/users?email=nobody%40dopbase.com");
      expect(page.status).toBe(200);
      expect(page.data.items).toEqual([]);
    });
    await step("Something that isn't an email is 422 EMAIL_INVALID", async () => {
      for (const email of ["not-an-email", "a@", "two%20words%40dopbase.com"]) {
        const page = await app.service.get(`/admin/users?email=${email}`);
        expect(page.status, email).toBe(422);
        expect(page.code, email).toBe("EMAIL_INVALID");
      }
    });
  },
);

test(
  "the status filter separates active and disabled users",
  {
    tag: "@users",
    annotation: about(
      "status=disabled lists only disabled accounts and status=active the rest. An unknown status is REQUEST_INVALID.",
    ),
  },
  async () => {
    const { users } = await seed();
    const victim = users[0]!;
    await step("POST /admin/users/{id}/disable on one user", async () => {
      expect((await app.service.post(`/admin/users/${victim.id}/disable`)).status).toBe(200);
    });
    try {
      await step("status=disabled lists just that user", async () => {
        const page = await app.service.get("/admin/users?status=disabled");
        expect(page.data.items.map((user: any) => user.id)).toEqual([victim.id]);
        expect(page.data.items[0].status).toBe("disabled");
      });
      await step("status=active lists the others and not that user", async () => {
        const page = await app.service.get("/admin/users?status=active");
        const ids = page.data.items.map((user: any) => user.id);
        expect(ids).not.toContain(victim.id);
        expect(ids).toContain(users[1]!.id);
        expect(page.data.items.every((user: any) => user.status === "active")).toBe(true);
      });
      await step("The status filter combines with search", async () => {
        const hit = await app.service.get("/admin/users?status=disabled&search=alpha");
        expect(hit.data.items).toHaveLength(1);
        const miss = await app.service.get("/admin/users?status=active&search=alpha");
        expect(miss.data.items).toEqual([]);
      });
      await step("An unknown status is REQUEST_INVALID", async () => {
        const page = await app.service.get("/admin/users?status=banned");
        expect(page.status).toBe(400);
        expect(page.code).toBe("REQUEST_INVALID");
      });
    } finally {
      await app.service.post(`/admin/users/${victim.id}/enable`, undefined, { record: false });
    }
  },
);

test(
  "paging with limit and cursor visits every user once, newest first",
  {
    tag: "@users",
    annotation: about(
      "Passing nextCursor back as cursor walks the list page by page until nextCursor is null, with no repeats and no gaps, and it matches the one-page answer.",
    ),
  },
  async () => {
    const { users } = await seed();
    const everyone = await step("GET /admin/users with a big limit", async () => {
      const page = await app.service.get("/admin/users?limit=200");
      return page.data.items.map((user: any) => user.id) as string[];
    });
    await step("limit=1 answers one item and a cursor", async () => {
      const page = await app.service.get("/admin/users?limit=1");
      expect(page.data.items).toHaveLength(1);
      expect(page.data.items[0].id).toBe(users[users.length - 1]!.id);
      expect(page.data.nextCursor).toEqual(expect.any(String));
    });
    await step("Pages of 3 end with a null cursor and match the single page", async () => {
      const { ids, pages } = await allPages("/admin/users", 3);
      expect(ids).toEqual(everyone);
      expect(new Set(ids).size).toBe(ids.length);
      expect(pages).toBe(Math.ceil(everyone.length / 3));
    });
    await step("Pages of 1 give the same order", async () => {
      const { ids, pages } = await allPages("/admin/users", 1);
      expect(ids).toEqual(everyone);
      expect(pages).toBe(everyone.length);
    });
    await step("A page that holds every user has no cursor", async () => {
      const page = await app.service.get(`/admin/users?limit=${everyone.length}`);
      expect(page.data.items).toHaveLength(everyone.length);
      expect(page.data.nextCursor).toBeNull();
    });
    await step("A user created between two pages never repeats or shifts the second page", async () => {
      const first = await app.service.get("/admin/users?limit=2");
      const late = await app.service.post("/admin/users", { email: app.email("late") });
      const second = await app.service.get(
        `/admin/users?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`,
      );
      const seen = [...first.data.items, ...second.data.items].map((user: any) => user.id);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).not.toContain(late.data.id);
    });
  },
);

test(
  "limit is held to 1 to 200 and a bad cursor is refused",
  {
    tag: "@users",
    annotation: about(
      "A limit under 1 or over 200 is clamped into range instead of failing. A cursor that isn't one Dopgate made answers 400 REQUEST_INVALID.",
    ),
  },
  async () => {
    await seed();
    await step("limit=0 is treated as 1", async () => {
      const page = await app.service.get("/admin/users?limit=0");
      expect(page.status).toBe(200);
      expect(page.data.items).toHaveLength(1);
    });
    await step("limit=500 is treated as 200", async () => {
      const page = await app.service.get("/admin/users?limit=500");
      expect(page.status).toBe(200);
      expect(page.data.items.length).toBeLessThanOrEqual(200);
      expect(page.data.items.length).toBeGreaterThanOrEqual(7);
    });
    await step("A limit that isn't a number is REQUEST_INVALID", async () => {
      const page = await app.service.get("/admin/users?limit=many");
      expect(page.status).toBe(400);
      expect(page.code).toBe("REQUEST_INVALID");
    });
    await step("Cursors that aren't valid are 400 REQUEST_INVALID", async () => {
      const text = (value: string) => Buffer.from(value).toString("base64url");
      for (const cursor of [
        "not a cursor",
        "zzz",
        text("no-separator"),
        text("not-a-time|usr_x"),
      ]) {
        const page = await app.service.get(`/admin/users?cursor=${encodeURIComponent(cursor)}`);
        expect(page.status, cursor).toBe(400);
        expect(page.code, cursor).toBe("REQUEST_INVALID");
      }
    });
  },
);

test(
  "the list is closed to people without an admin credential",
  {
    tag: ["@users", "@security"],
    annotation: about(
      "No token is 401, a user's own token is 403, and an admin from the console can read the list.",
    ),
  },
  async () => {
    const user = await app.user("reader");
    await step("GET /admin/users with no token is 401", async () => {
      const page = await app.api.get("/admin/users");
      expect(page.status).toBe(401);
      expect(page.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("GET /admin/users with a user's token is 403", async () => {
      const page = await user.api.get("/admin/users");
      expect(page.status).toBe(403);
      expect(page.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("GET /admin/users as root is 200", async () => {
      const root = await app.root();
      const page = await root.api.get("/admin/users?limit=2");
      expect(page.status).toBe(200);
      expect(page.data.items).toHaveLength(2);
    });
  },
);
