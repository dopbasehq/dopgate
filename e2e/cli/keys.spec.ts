import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";
import { jwtHeader, verifiedByJwks } from "../harness/helpers.ts";
import { databaseUrl, query } from "../harness/server.ts";
import { instanceEnv, tempFolder, withSchema, writeIn } from "./support.ts";

const app = useServer();

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";
const keyList = async () =>
  (await app.service.get("/admin/keys", { record: false })).data as {
    id: string;
    status: string;
    rotatedAt: string | null;
    retiredAt: string | null;
  }[];

test(
  "keys rotate makes a new active key while the server is running",
  {
    tag: ["@smoke", "@keys"],
    annotation: about(
      "`dopgate keys rotate` against a running instance writes a new active key and moves the old one to retiring. The admin API shows the change at once, and the console's own tokens stop working at once because the console secret changes in the same step.",
    ),
  },
  async () => {
    const before = await keyList();
    const root = await app.consoleSession(ROOT_EMAIL, PASSWORD, "cli-rotate");
    const done = await step("dopgate keys rotate", () => app.cli(["keys", "rotate"]).ok());
    await step("It says which key is new and how long the old one lasts", async () => {
      const id = done.stdout.match(/New signing key (key_\S+)\./)?.[1];
      expect(id).toBeTruthy();
      expect(done.stdout).toContain("The previous key verifies its tokens for one more day.");
      expect(done.stdout).toContain("✓");
    });
    const newId = done.stdout.match(/New signing key (key_\S+)\./)![1]!;
    await step("GET /admin/keys has the new key active and the old one retiring", async () => {
      const after = await keyList();
      expect(after).toHaveLength(before.length + 1);
      expect(after.filter((key) => key.status === "active").map((key) => key.id)).toEqual([newId]);
      const previous = after.find((key) => key.id === before.find((k) => k.status === "active")!.id);
      expect(previous).toMatchObject({ status: "retiring", retiredAt: null });
      expect(previous!.rotatedAt).toBeTruthy();
    });
    await step("The console token from before the rotation stops working at once", async () => {
      const refused = await app.api.get("/admin/keys", {
        token: root.tokens.accessToken,
        record: false,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
    await step("The console refreshes into a working token", async () => {
      const refreshed = await app.api.post(
        "/console/refresh",
        { refreshToken: root.tokens.refreshToken },
        { record: false },
      );
      expect(refreshed.status).toBe(200);
      const ok = await app.api.get("/admin/keys", {
        token: refreshed.data.accessToken,
        record: false,
      });
      expect(ok.status).toBe(200);
    });
    await step("The audit log records key.rotated by the system, labelled cli", async () => {
      const events = await app.service.get("/admin/audit-events?action=key.rotated", {
        record: false,
      });
      expect(events.data.items[0]).toMatchObject({
        actorType: "system",
        actorLabel: "cli",
        action: "key.rotated",
        resourceType: "signing_key",
        resourceId: newId,
      });
    });
  },
);

test(
  "keys rotate --json prints the new key",
  {
    tag: ["@keys"],
    annotation: about(
      "With --json the answer is a single line on standard output: success and the key as the admin API shows it, active, with no rotation or retirement time yet.",
    ),
  },
  async () => {
    const body = await step("dopgate --json keys rotate", () =>
      app.cli(["--json", "keys", "rotate"]).json(),
    );
    await step("It is success with an active ES256 key", async () => {
      expect(body).toEqual({
        success: true,
        data: {
          id: expect.stringMatching(/^key_/),
          algorithm: "ES256",
          status: "active",
          createdAt: expect.any(String),
          rotatedAt: null,
          retiredAt: null,
        },
      });
    });
    await step("It is the key GET /admin/keys lists as active", async () => {
      const active = (await keyList()).filter((key) => key.status === "active");
      expect(active.map((key) => key.id)).toEqual([body.data.id]);
    });
  },
);

test(
  "a running server starts signing with the rotated key within a minute",
  {
    tag: ["@keys", "@tokens"],
    annotation: about(
      "A server reloads its signing keys every minute, so a rotation from the command line takes effect without a restart. The test polls the key set until the new key is in it, then checks that tokens signed before still verify and new sign-ins use the new key.",
    ),
  },
  async () => {
    test.setTimeout(120_000);
    const user = await app.user("ana");
    const oldToken = user.tokens!.accessToken;
    const oldKid = jwtHeader(oldToken).kid as string;
    const rotated = await step("dopgate --json keys rotate", () =>
      app.cli(["--json", "keys", "rotate"]).json(),
    );
    const newKid = rotated.data.id as string;
    await step("The server's key set gets the new key as well as the old one", async () => {
      await expect
        .poll(
          async () =>
            ((await app.api.get("/.well-known/jwks.json", { record: false })).body.keys as { kid: string }[]).map(
              (key) => key.kid,
            ),
          { timeout: 90_000, intervals: [1000, 2000, 3000], message: "the server reloads its keys" },
        )
        .toEqual(expect.arrayContaining([newKid, oldKid]));
    });
    await step("A token signed before the rotation still verifies and works", async () => {
      const set = (await app.api.get("/.well-known/jwks.json", { record: false })).body;
      expect(await verifiedByJwks(oldToken, set)).toBe(true);
      expect((await user.api.get("/auth/me", { record: false })).status).toBe(200);
    });
    await step("A new sign-in is signed by the new key", async () => {
      const again = await app.userSession(user.email);
      expect(jwtHeader(again.tokens.accessToken).kid).toBe(newKid);
      const set = (await app.api.get("/.well-known/jwks.json", { record: false })).body;
      expect(await verifiedByJwks(again.tokens.accessToken, set)).toBe(true);
    });
  },
);

test(
  "keys rotate takes the database from --database-url",
  {
    tag: ["@keys"],
    annotation: about(
      "The database can be named with a flag instead of DOPGATE_DATABASE_URL. The flag wins over a wrong value in the environment, and only the schema comes from the environment here.",
    ),
  },
  async () => {
    const before = await keyList();
    const done = await step("dopgate --json keys rotate --database-url <url> with a wrong URL in the environment", () =>
      app
        .cliRaw(["--json", "keys", "rotate", "--database-url", databaseUrl()], {
          env: {
            DOPGATE_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
            DOPGATE_DATABASE_SCHEMA: app.server.schema,
            RUST_LOG: "off",
          },
        })
        .json(),
    );
    await step("The server's own instance got the new key", async () => {
      const after = await keyList();
      expect(after).toHaveLength(before.length + 1);
      expect(after.find((key) => key.status === "active")!.id).toBe(done.data.id);
    });
  },
);

test(
  "keys rotate takes the instance from a config file",
  {
    tag: ["@keys"],
    annotation: about(
      "--config and DOPGATE_CONFIG name a TOML file that holds the database URL and schema, so rotating needs no other setting.",
    ),
  },
  async () => {
    const folder = await tempFolder("keys-config");
    try {
      const path = await writeIn(
        folder.dir,
        "dopgate.toml",
        `database_url = "${databaseUrl()}"\ndatabase_schema = "${app.server.schema}"\n`,
      );
      const before = await keyList();
      await step("dopgate keys rotate --config <file>", async () => {
        const done = await app
          .cliRaw(["--json", "keys", "rotate", "--config", path], { env: { RUST_LOG: "off" } })
          .json();
        expect(done.data.status).toBe("active");
      });
      await step("dopgate keys rotate with DOPGATE_CONFIG", async () => {
        await app
          .cliRaw(["keys", "rotate"], { env: { DOPGATE_CONFIG: path, RUST_LOG: "off" } })
          .ok();
      });
      await step("Both rotations are in the server's key list", async () => {
        expect(await keyList()).toHaveLength(before.length + 2);
      });
    } finally {
      await folder.remove();
    }
  },
);

test(
  "keys rotate fails with exit 1 when the database can't be used",
  {
    tag: ["@keys"],
    annotation: about(
      "A wrong database login, a database that doesn't exist, a URL that isn't PostgreSQL and no URL at all each exit 1. The message says what is wrong and never prints the password from the URL.",
    ),
  },
  async () => {
    const good = new URL(databaseUrl());
    const withPassword = (change: (url: URL) => void) => {
      const url = new URL(good.toString());
      url.password = "wrong-secret-pw";
      change(url);
      return url.toString();
    };
    await step("A wrong password", async () => {
      const refused = await app
        .cliRaw(["--json", "keys", "rotate", "--database-url", withPassword(() => {})], {
          env: { DOPGATE_DATABASE_SCHEMA: app.server.schema, RUST_LOG: "off" },
        })
        .fails(1);
      const body = JSON.parse(lastLine(refused.stderr));
      expect(body.success).toBe(false);
      expect(body.error.CLI_ERROR).toContain("failed to reach PostgreSQL");
      expect(refused.stderr).not.toContain("wrong-secret-pw");
      expect(refused.stdout).toBe("");
    });
    await step("A database that doesn't exist", async () => {
      const refused = await app
        .cliRaw(
          ["keys", "rotate", "--database-url", withPassword((url) => (url.pathname = "/no_such_database"))],
          { env: { DOPGATE_DATABASE_SCHEMA: app.server.schema, RUST_LOG: "off" } },
        )
        .fails(1);
      expect(refused.stderr).toContain("Error: failed to reach PostgreSQL");
      expect(refused.stderr).toContain("no_such_database");
    });
    await step("A URL that isn't PostgreSQL", async () => {
      const refused = await app
        .cliRaw(["keys", "rotate", "--database-url", "mysql://localhost/app"], {
          env: { RUST_LOG: "off" },
        })
        .fails(1);
      expect(refused.stderr).toContain("must start with postgres:// or postgresql://");
    });
    await step("No database at all", async () => {
      const refused = await app.cliRaw(["--json", "keys", "rotate"], { env: { RUST_LOG: "off" } }).fails(1);
      expect(JSON.parse(lastLine(refused.stderr)).error.CLI_ERROR).toContain("DOPGATE_DATABASE_URL");
    });
    await step("The server's keys are as they were", async () => {
      expect((await keyList()).filter((key) => key.status === "active")).toHaveLength(1);
    });
  },
);

test(
  "keys rotate on a new database sets it up but creates no root",
  {
    tag: ["@keys", "@setup"],
    annotation: about(
      "Rotating works on an empty schema: it runs the migrations, makes the first key and rotates it. DOPGATE_ROOT_EMAIL is ignored here, since root setup belongs to serve and init, so init still works afterwards.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      await step("dopgate keys rotate on a schema with nothing in it, with DOPGATE_ROOT_EMAIL set", async () => {
        await app
          .cli(["keys", "rotate"], {
            env: { ...env, DOPGATE_ROOT_EMAIL: "root@example.com", DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .ok();
      });
      await step("There are two keys, one active and one retiring, and no admin", async () => {
        const keys = await query<{ status: string }>(
          schema,
          "SELECT status FROM signing_keys ORDER BY created_at",
        );
        expect(keys.map((key) => key.status)).toEqual(["retiring", "active"]);
        expect(await query(schema, "SELECT id FROM admins")).toEqual([]);
      });
      await step("dopgate init still makes the root", async () => {
        await app
          .cli(["init", "--email", "root@example.com"], {
            env: { ...instanceEnv(schema), DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .ok();
      });
    });
  },
);
