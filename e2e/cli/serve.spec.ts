import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ApiClient } from "../harness/api.ts";
import { about, expect, step, test, useServer } from "../harness/index.ts";
import { recordHit } from "../harness/record.ts";
import {
  databaseUrl,
  dropSchema,
  newSchema,
  newServiceKey,
  query,
} from "../harness/server.ts";
import {
  freePort,
  startServe,
  tempFolder,
  withSchema,
  writeIn,
  type Running,
} from "./support.ts";

// The file's own server is only here for app.cliRaw(): every case starts the
// binary by hand, on a port and a schema of its own.
const app = useServer();
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const toml = (value: unknown) => JSON.stringify(value);

/** The settings that point a server at one schema, and keep it offline. */
function serveEnv(schema: string, extra: Record<string, string> = {}) {
  return {
    DOPGATE_DATABASE_URL: databaseUrl(),
    DOPGATE_DATABASE_SCHEMA: schema,
    DOPGATE_DATABASE_MAX_CONNECTIONS: "3",
    // Nothing here should reach the internet, and a refused connection is quick.
    DOPGATE_LEAKED_PASSWORDS_URL: "http://127.0.0.1:1",
    ...extra,
  };
}

async function reaches(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

const get = (url: string, path: string) => fetch(`${url}${path}`);

async function stopAll(...running: Running[]) {
  for (const server of running) await server.stop();
}

test(
  "serve flags win over the environment",
  {
    tag: ["@smoke"],
    annotation: about(
      "--port, --host, --public-url, --database-url, --docs and --web-ui beat DOPGATE_* settings. A server told to listen on one port and show no console or docs by flags does that, whatever the environment says.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    await withSchema(async (schema) => {
      const envPort = await freePort();
      const flagPort = await freePort();
      const server = await startServe(
        [
          "--port", String(flagPort),
          "--host", "127.0.0.1",
          "--public-url", "https://auth.flag.example.com",
          "--database-url", databaseUrl(),
          "--docs", "false",
          "--web-ui", "false",
        ],
        {
          port: flagPort,
          env: serveEnv(schema, {
            DOPGATE_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
            DOPGATE_PORT: String(envPort),
            DOPGATE_HOST: "0.0.0.0",
            DOPGATE_PUBLIC_URL: "http://env.example.com",
            DOPGATE_DOCS: "true",
            DOPGATE_WEB_UI: "true",
          }),
        },
      );
      try {
        await step("dopgate serve with the flags, against a different environment", () =>
          server.waitHealthy(),
        );
        await step("It listens on the flag's port and not the environment's", async () => {
          expect(await reaches(server.url)).toBe(true);
          expect(await reaches(`http://127.0.0.1:${envPort}`)).toBe(false);
        });
        await step("The flag's public URL is the issuer", async () => {
          const discovery = await (await get(server.url, "/.well-known/openid-configuration")).json();
          expect(discovery.issuer).toBe("https://auth.flag.example.com");
        });
        await step("The docs and the console are off", async () => {
          expect((await get(server.url, "/api/v1/openapi.json")).status).toBe(404);
          expect((await get(server.url, "/api/docs/")).status).toBe(404);
          expect((await get(server.url, "/")).status).toBe(404);
        });
        await step("The banner shows the flag values and no Console or API docs line", async () => {
          const log = server.output();
          expect(log).toContain("Public URL: https://auth.flag.example.com");
          expect(log).toContain(`Bind:       127.0.0.1:${flagPort}`);
          expect(log).not.toContain("Console:");
          expect(log).not.toContain("API docs:");
        });
      } finally {
        await stopAll(server);
      }

      // The other way round: flags turn on what the environment turned off.
      const second = await freePort();
      const flagsOn = await startServe(
        ["--port", String(second), "--docs", "true", "--web-ui", "true"],
        {
          port: second,
          env: serveEnv(schema, { DOPGATE_DOCS: "false", DOPGATE_WEB_UI: "false" }),
        },
      );
      try {
        await step("dopgate serve --docs true --web-ui true against an environment that says false", () =>
          flagsOn.waitHealthy(),
        );
        await step("The docs and the console are served", async () => {
          expect((await get(flagsOn.url, "/api/v1/openapi.json")).status).toBe(200);
          const page = await get(flagsOn.url, "/");
          expect(page.status).toBe(200);
          expect(page.headers.get("content-type")).toContain("text/html");
        });
        await step("The banner lists the API docs address", async () => {
          expect(flagsOn.output()).toContain(`API docs:   http://localhost:${second}/api/docs`);
        });
      } finally {
        await stopAll(flagsOn);
      }
    });
  },
);

test(
  "the startup banner names the address, the API, the key set and the schema",
  {
    tag: ["@smoke"],
    annotation: about(
      "Starting prints what an operator needs to check: the version, the public URL and bind address, the API and JWKS URLs, the database without its password and the schema, and the console and docs addresses when they are on. The docs are off unless asked for, so a plain start lists none.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    await withSchema(async (schema) => {
      const port = await freePort();
      const server = await startServe([], {
        port,
        env: serveEnv(schema, { DOPGATE_PORT: String(port), DOPGATE_ROOT_EMAIL: "banner@example.com" }),
      });
      try {
        await step("dopgate serve with only a port in the environment", () => server.waitHealthy());
        const log = server.output();
        await step("The banner has the product line and the version", async () => {
          expect(log).toContain("Dopgate");
          expect(log).toContain("Modern auth for people and AI agents");
          expect(log).toContain(`Version ${pkg.version}`);
        });
        await step("The public URL defaults to localhost on that port", async () => {
          expect(log).toContain(`Public URL: http://localhost:${port}`);
          expect(log).toContain(`Bind:       127.0.0.1:${port}`);
        });
        await step("The API, key set and console addresses are listed", async () => {
          expect(log).toContain(`API:        http://localhost:${port}/api/v1`);
          expect(log).toContain(`JWKS:       http://localhost:${port}/.well-known/jwks.json`);
          expect(log).toContain(`Console:    http://localhost:${port}/`);
        });
        await step("The docs are off by default: no API docs line, and no OpenAPI document", async () => {
          expect(log).not.toContain("API docs:");
          expect((await get(server.url, "/api/v1/openapi.json")).status).toBe(404);
          expect((await get(server.url, "/api/docs/")).status).toBe(404);
        });
        await step("The database is named with its password hidden, next to the schema", async () => {
          const database = new URL(databaseUrl());
          expect(log).toContain(`schema ${schema})`);
          expect(log).toContain(`Database:   postgres://`);
          if (database.password) {
            expect(log).not.toContain(database.password);
            expect(log).toContain(":***@");
          }
        });
        await step("It logs that the server started, on the bind address", async () => {
          expect(log).toContain("Dopgate server started");
          expect(log).toContain(`127.0.0.1:${port}`);
        });
        await step("The public URL is the issuer of the key set's discovery document", async () => {
          const discovery = await (await get(server.url, "/.well-known/openid-configuration")).json();
          expect(discovery.issuer).toBe(`http://localhost:${port}`);
        });
      } finally {
        await stopAll(server);
      }
    });
  },
);

test(
  "serve warns when the public URL is a placeholder or plain HTTP",
  {
    tag: ["@setup"],
    annotation: about(
      "Listening on every interface without a public URL leaves a SERVER_HOST placeholder, and serve says to replace it. A public URL on http:// away from localhost gets a warning that passwords travel unencrypted. An https:// one gets none.",
    ),
  },
  async () => {
    await withSchema(async (schema) => {
      const run = async (args: string[], env: Record<string, string> = {}) => {
        const port = await freePort();
        const server = await startServe(["--port", String(port), ...args], {
          port,
          env: serveEnv(schema, env),
        });
        try {
          await server.waitHealthy();
          return { port, log: server.output(), url: server.url };
        } finally {
          await stopAll(server);
        }
      };
      await step("dopgate serve --host 0.0.0.0 with no public URL", async () => {
        const result = await run(["--host", "0.0.0.0"]);
        expect(result.log).toContain(`Public URL: http://SERVER_HOST:${result.port}`);
        expect(result.log).toContain("Warning: Replace SERVER_HOST with this server's public address.");
        expect(result.log).toContain("DOPGATE_PUBLIC_URL");
      });
      await step("dopgate serve --public-url http://auth.example.com", async () => {
        const result = await run(["--public-url", "http://auth.example.com"]);
        expect(result.log).toContain("Warning: The public URL http://auth.example.com uses HTTP.");
        expect(result.log).toContain("Passwords and tokens are not encrypted");
      });
      await step("dopgate serve --public-url https://auth.example.com", async () => {
        const result = await run(["--public-url", "https://auth.example.com"]);
        expect(result.log).not.toContain("Warning:");
      });
      await step("dopgate serve --public-url http://localhost:3000 needs no warning", async () => {
        const result = await run(["--public-url", "http://localhost:3000"]);
        expect(result.log).not.toContain("Warning:");
      });
    });
  },
);

test(
  "DOPGATE_HOST=localhost listens on 127.0.0.1",
  {
    tag: ["@setup"],
    annotation: about(
      "`localhost` is accepted as a host name and means the IPv4 loopback address.",
    ),
  },
  async () => {
    await withSchema(async (schema) => {
      const port = await freePort();
      const server = await startServe([], {
        port,
        env: serveEnv(schema, { DOPGATE_HOST: "localhost", DOPGATE_PORT: String(port) }),
      });
      try {
        await step("dopgate serve with DOPGATE_HOST=localhost", () => server.waitHealthy());
        await step("The banner says it is bound to 127.0.0.1", async () => {
          expect(server.output()).toContain(`Bind:       127.0.0.1:${port}`);
        });
      } finally {
        await stopAll(server);
      }
    });
  },
);

test(
  "a config file alone is enough to run a server",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "Every setting can live in the TOML file: the database, the address, the public URL, the service key, the allowed origin, the docs and console switches and the root email. The server starts with only --config, uses each of them, and prints the generated root password once.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    const folder = await tempFolder("serve-file");
    try {
      await withSchema(async (schema) => {
        const port = await freePort();
        const serviceKey = newServiceKey();
        const path = await writeIn(
          folder.dir,
          "dopgate.toml",
          [
            "version = 1",
            `database_url = ${toml(databaseUrl())}`,
            `database_schema = ${toml(schema)}`,
            `public_url = ${toml(`http://127.0.0.1:${port}`)}`,
            `host = "127.0.0.1"`,
            `port = ${port}`,
            "shutdown_grace_seconds = 5",
            "audit_retention_days = 30",
            `allowed_origins = ["https://app.example.com"]`,
            `service_key = ${toml(serviceKey)}`,
            `root_email = "File.Root@Example.com"`,
            "docs = true",
            "web_ui = false",
            "",
          ].join("\n"),
        );
        const server = await startServe(["--config", path], {
          port,
          env: { DOPGATE_DATABASE_MAX_CONNECTIONS: "3" },
        });
        try {
          await step("dopgate serve --config dopgate.toml, with nothing else set", () =>
            server.waitHealthy(),
          );
          await step("The server listens where the file says, with the file's public URL", async () => {
            const discovery = await (await get(server.url, "/.well-known/openid-configuration")).json();
            expect(discovery.issuer).toBe(`http://127.0.0.1:${port}`);
          });
          await step("The service key from the file opens the admin API", async () => {
            const keys = await fetch(`${server.url}/api/v1/admin/keys`, {
              headers: { authorization: `Bearer ${serviceKey}` },
            });
            expect(keys.status).toBe(200);
          });
          await step("The allowed origin from the file gets CORS headers", async () => {
            const answer = await fetch(`${server.url}/api/v1/health`, {
              headers: { origin: "https://app.example.com" },
            });
            expect(answer.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
          });
          await step("The docs are on and the console is off, both unlike the defaults", async () => {
            expect((await get(server.url, "/api/v1/openapi.json")).status).toBe(200);
            expect((await get(server.url, "/")).status).toBe(404);
          });
          await step("Root was created for the file's email, with a printed password that works", async () => {
            const log = server.output();
            expect(log).toContain("Root account created for file.root@example.com.");
            const password = log.match(/^Password: (\S+)$/m)?.[1];
            expect(password).toBeTruthy();
            const api = await ApiClient.create(server.url, "root", []);
            try {
              const signedIn = await api.post(
                "/console/login",
                { email: "file.root@example.com", password },
                { record: false },
              );
              expect(signedIn.status).toBe(200);
            } finally {
              await api.dispose();
            }
          });
        } finally {
          await stopAll(server);
        }
      });
    } finally {
      await folder.remove();
    }
  },
);

test(
  "settings win in order: flag, then environment, then file",
  {
    tag: ["@setup"],
    annotation: about(
      "The same setting in the file, the environment and a flag takes the flag's value, then the environment's, then the file's. --config beats DOPGATE_CONFIG for choosing the file.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    const folder = await tempFolder("serve-order");
    try {
      await withSchema(async (schema) => {
        const filePort = await freePort();
        const envPort = await freePort();
        const flagPort = await freePort();
        const file = await writeIn(
          folder.dir,
          "file.toml",
          [
            `host = "127.0.0.1"`,
            `port = ${filePort}`,
            `public_url = "https://file.example.com"`,
            "docs = true",
            "web_ui = false",
            "",
          ].join("\n"),
        );
        const probe = async (
          args: string[],
          env: Record<string, string>,
          port: number,
        ) => {
          const server = await startServe(args, { port, env: serveEnv(schema, env) });
          try {
            await server.waitHealthy();
            const discovery = await (await get(server.url, "/.well-known/openid-configuration")).json();
            const docs = (await get(server.url, "/api/v1/openapi.json")).status;
            return { issuer: discovery.issuer as string, docs };
          } finally {
            await stopAll(server);
          }
        };
        await step("File only: the file's port, public URL and switches", async () => {
          const result = await probe(["--config", file], {}, filePort);
          expect(result).toEqual({ issuer: "https://file.example.com", docs: 200 });
        });
        await step("File and environment: the environment wins", async () => {
          const result = await probe(
            ["--config", file],
            {
              DOPGATE_PORT: String(envPort),
              DOPGATE_PUBLIC_URL: "https://env.example.com",
              DOPGATE_DOCS: "false",
            },
            envPort,
          );
          expect(result).toEqual({ issuer: "https://env.example.com", docs: 404 });
        });
        await step("File, environment and flags: the flags win", async () => {
          const result = await probe(
            ["--config", file, "--port", String(flagPort), "--public-url", "https://flag.example.com", "--docs", "true"],
            {
              DOPGATE_PORT: String(envPort),
              DOPGATE_PUBLIC_URL: "https://env.example.com",
              DOPGATE_DOCS: "false",
            },
            flagPort,
          );
          expect(result).toEqual({ issuer: "https://flag.example.com", docs: 200 });
        });
        await step("DOPGATE_CONFIG names the file when there is no flag", async () => {
          const result = await probe([], { DOPGATE_CONFIG: file }, filePort);
          expect(result.issuer).toBe("https://file.example.com");
        });
        await step("--config wins over DOPGATE_CONFIG", async () => {
          const other = await writeIn(
            folder.dir,
            "other.toml",
            `host = "127.0.0.1"\nport = ${filePort}\npublic_url = "https://other.example.com"\n`,
          );
          const result = await probe(["--config", other], { DOPGATE_CONFIG: file }, filePort);
          expect(result.issuer).toBe("https://other.example.com");
        });
      });
    } finally {
      await folder.remove();
    }
  },
);

test(
  "a config path may be relative to the working directory or start with ~/",
  {
    tag: ["@setup"],
    annotation: about(
      "A relative --config path is read from the folder the command runs in, and `~/` stands for the home directory, even though no shell expanded it.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    const folder = await tempFolder("serve-paths");
    try {
      await withSchema(async (schema) => {
        const port = await freePort();
        await writeIn(
          folder.dir,
          "dopgate.toml",
          `host = "127.0.0.1"\nport = ${port}\npublic_url = "https://paths.example.com"\n`,
        );
        const issuerFor = async (args: string[], env: Record<string, string>, cwd?: string) => {
          const server = await startServe(args, { port, env: serveEnv(schema, env), cwd });
          try {
            await server.waitHealthy();
            return (await (await get(server.url, "/.well-known/openid-configuration")).json()).issuer;
          } finally {
            await stopAll(server);
          }
        };
        await step("--config ./dopgate.toml from inside the folder", async () => {
          expect(await issuerFor(["--config", "./dopgate.toml"], {}, folder.dir)).toBe(
            "https://paths.example.com",
          );
        });
        await step("--config ~/dopgate.toml with HOME set to the folder", async () => {
          expect(await issuerFor(["--config", "~/dopgate.toml"], { HOME: folder.dir })).toBe(
            "https://paths.example.com",
          );
        });
      });
    } finally {
      await folder.remove();
    }
  },
);

test(
  "serve refuses a config file with an unknown key, a bad version or bad syntax",
  {
    tag: ["@setup"],
    annotation: about(
      "Typos must not go unnoticed. An unknown key at the top or under [smtp], a version other than 1, a value of the wrong type, broken TOML and a file that isn't there each stop startup with exit 1 and a message that names the file or the key.",
    ),
  },
  async () => {
    const folder = await tempFolder("serve-bad-file");
    try {
      const env = serveEnv(newSchema());
      const cases: [string, string, string][] = [
        ["an unknown key", `databse_url = "x"\n`, "unknown field `databse_url`"],
        ["an unknown key under [smtp]", `[smtp]\nhots = "x"\n`, "unknown field `hots`"],
        ["a version other than 1", "version = 2\n", "unsupported server configuration version 2"],
        ["a number given as text", `port = "8850"\n`, "failed to parse"],
        ["broken TOML", "port = \n", "failed to parse"],
        ["a service key in the file that is too short", `service_key = "short"\n`, "at least 32 characters"],
        ["a public URL that isn't one", `public_url = "not a url"\n`, "public_url"],
        ["an allowed origin with a path", `allowed_origins = ["https://x.com/app"]\n`, "must be an origin"],
        ["a root email that isn't one", `root_email = "nope"\n`, "is not a valid email address"],
      ];
      for (const [name, text, message] of cases) {
        await step(`dopgate serve --config with ${name}`, async () => {
          const path = await writeIn(folder.dir, "bad.toml", text);
          const refused = await app
            .cliRaw(["serve", "--config", path], { env, timeoutMs: 30_000 })
            .fails(1);
          expect(refused.stderr).toContain("Error:");
          expect(refused.stderr).toContain(message);
          expect(refused.stdout).toBe("");
        });
      }
      await step("dopgate serve --config for a file that doesn't exist", async () => {
        const missing = join(folder.dir, "missing.toml");
        const refused = await app
          .cliRaw(["serve", "--config", missing], { env, timeoutMs: 30_000 })
          .fails(1);
        expect(refused.stderr).toContain(`failed to read ${missing}`);
      });
    } finally {
      await folder.remove();
    }
  },
);

const refusals: { name: string; env: Record<string, string>; args?: string[]; message: string }[] = [
  { name: "no database URL", env: { DOPGATE_DATABASE_URL: "" }, message: "set DOPGATE_DATABASE_URL to a PostgreSQL URL" },
  { name: "a database URL that isn't PostgreSQL", env: { DOPGATE_DATABASE_URL: "mysql://localhost/app" }, message: "must start with postgres:// or postgresql://" },
  { name: "a public URL that isn't a URL", env: { DOPGATE_PUBLIC_URL: "notaurl" }, message: "invalid public_url" },
  { name: "a public URL with another scheme", env: { DOPGATE_PUBLIC_URL: "ftp://auth.example.com" }, message: "public_url must be an absolute HTTP or HTTPS URL" },
  { name: "a public URL given by --public-url that isn't a URL", env: {}, args: ["--public-url", "notaurl"], message: "invalid public_url" },
  { name: "a service key under 32 characters", env: { DOPGATE_SERVICE_KEY: "too-short" }, message: "DOPGATE_SERVICE_KEY must be at least 32 characters" },
  { name: "a root email that isn't an address", env: { DOPGATE_ROOT_EMAIL: "nope" }, message: 'DOPGATE_ROOT_EMAIL "nope" is not a valid email address' },
  { name: "a port that isn't a number", env: { DOPGATE_PORT: "abc" }, message: "invalid DOPGATE_PORT" },
  { name: "a port above 65535", env: { DOPGATE_PORT: "99999" }, message: "invalid DOPGATE_PORT" },
  { name: "a host that isn't an address", env: { DOPGATE_HOST: "not-an-ip" }, message: 'invalid host "not-an-ip"' },
  { name: "a leaked password list URL with another scheme", env: { DOPGATE_LEAKED_PASSWORDS_URL: "ftp://lists.example.com" }, message: "invalid DOPGATE_LEAKED_PASSWORDS_URL: URL must use HTTP or HTTPS" },
  { name: "a leaked password list URL that isn't a URL", env: { DOPGATE_LEAKED_PASSWORDS_URL: "notaurl" }, message: "invalid DOPGATE_LEAKED_PASSWORDS_URL" },
  { name: "a schema name with capitals and a dash", env: { DOPGATE_DATABASE_SCHEMA: "Bad-Schema" }, message: 'database schema "Bad-Schema" must use lowercase letters' },
  { name: "a schema name that starts with pg_", env: { DOPGATE_DATABASE_SCHEMA: "pg_mine" }, message: 'database schema "pg_mine"' },
  { name: "no connections allowed in the pool", env: { DOPGATE_DATABASE_MAX_CONNECTIONS: "0" }, message: "DOPGATE_DATABASE_MAX_CONNECTIONS must be between 1 and 1000" },
  { name: "a pool size that isn't a number", env: { DOPGATE_DATABASE_MAX_CONNECTIONS: "many" }, message: "invalid DOPGATE_DATABASE_MAX_CONNECTIONS" },
  { name: "a shutdown grace of 0 seconds", env: { DOPGATE_SHUTDOWN_GRACE_SECONDS: "0" }, message: "shutdown_grace_seconds must be between 1 and 300" },
  { name: "a boolean that isn't true or false", env: { DOPGATE_DOCS: "maybe" }, message: "invalid DOPGATE_DOCS" },
  { name: "an empty boolean", env: { DOPGATE_WEB_UI: "" }, message: "invalid DOPGATE_WEB_UI" },
  { name: "an allowed origin with a path", env: { DOPGATE_ALLOWED_ORIGINS: "https://app.example.com/path" }, message: "must be an origin like https://app.example.com" },
  { name: "a trusted proxy that isn't an address", env: { DOPGATE_TRUSTED_PROXIES: "not-an-ip" }, message: "invalid DOPGATE_TRUSTED_PROXIES" },
  { name: "an audit retention that isn't a number", env: { DOPGATE_AUDIT_RETENTION_DAYS: "forever" }, message: "invalid DOPGATE_AUDIT_RETENTION_DAYS" },
  { name: "an SMTP URL without a scheme", env: { DOPGATE_SMTP_URL: "mail.example.com:587" }, message: "invalid DOPGATE_SMTP_URL: the URL must start with smtp:// or smtps://" },
  { name: "an SMTP URL without a host", env: { DOPGATE_SMTP_URL: "smtp://" }, message: "invalid DOPGATE_SMTP_URL" },
  { name: "an SMTP URL with a path", env: { DOPGATE_SMTP_URL: "smtp://mail.example.com/inbox" }, message: "invalid DOPGATE_SMTP_URL: the URL takes no path" },
  { name: "an SMTP security option that doesn't exist", env: { DOPGATE_SMTP_URL: "smtp://mail.example.com?security=ssl" }, message: "invalid DOPGATE_SMTP_URL: the only option is ?security=none" },
  { name: "an SMTP sender that isn't an address", env: { DOPGATE_SMTP_URL: "smtp://mail.example.com", DOPGATE_SMTP_FROM_EMAIL: "nope" }, message: 'smtp from_email "nope" is not a valid address' },
];

test(
  "serve refuses to start on a setting it can't use and says which",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "Each value the docs list under 'Values that stop startup' exits 1 with a message that names the setting, prints nothing on standard output and never opens the database schema, so nothing half-starts.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    const schema = newSchema();
    try {
      for (const refusal of refusals) {
        await step(`dopgate serve with ${refusal.name}`, async () => {
          const env = { ...serveEnv(schema), ...refusal.env };
          const refused = await app
            .cliRaw(["serve", ...(refusal.args ?? [])], { env, timeoutMs: 30_000 })
            .fails(1);
          expect(refused.stderr).toContain("Error: ");
          expect(refused.stderr).toContain(refusal.message);
          expect(refused.stdout).toBe("");
          expect(refused.stderr).not.toContain("Dopgate server started");
        });
      }
      await step("None of them created the schema", async () => {
        const found = await query(
          schema,
          "SELECT nspname FROM pg_namespace WHERE nspname = $1",
          [schema],
        );
        expect(found).toEqual([]);
      });
    } finally {
      await dropSchema(schema);
    }
  },
);

test(
  "serve rejects a bad flag as a usage error",
  {
    tag: ["@setup"],
    annotation: about(
      "A flag value of the wrong kind is caught before any setting is read: exit 2 with the reason and a pointer to --help.",
    ),
  },
  async () => {
    await step("dopgate serve --port 70000", async () => {
      const refused = await app.cliRaw(["serve", "--port", "70000"]).fails(2);
      expect(refused.stderr).toContain("invalid value '70000' for '--port <PORT>'");
    });
    await step("dopgate serve --docs maybe", async () => {
      const refused = await app.cliRaw(["serve", "--docs", "maybe"]).fails(2);
      expect(refused.stderr).toContain("invalid value 'maybe' for '--docs <BOOL>'");
    });
    await step("dopgate serve --no-such-flag", async () => {
      const refused = await app.cliRaw(["serve", "--no-such-flag"]).fails(2);
      expect(refused.stderr).toContain("unexpected argument '--no-such-flag'");
      expect(refused.stderr).toContain("--help");
    });
  },
);

test(
  "serve fails with exit 1 when the port is taken",
  {
    tag: ["@setup"],
    annotation: about(
      "Starting on a port another process holds is an error, not a hang. serve exits 1 and says which address it could not bind.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    await withSchema(async (schema) => {
      const taken = createServer();
      await new Promise<void>((done) => taken.listen(0, "127.0.0.1", done));
      const port = (taken.address() as import("node:net").AddressInfo).port;
      try {
        const refused = await step("dopgate serve --port <a port in use>", () =>
          app
            .cliRaw(["serve", "--port", String(port), "--host", "127.0.0.1"], {
              env: serveEnv(schema),
              timeoutMs: 30_000,
            })
            .fails(1),
        );
        await step("It names the address it could not bind", async () => {
          expect(refused.stderr).toContain(`failed to bind 127.0.0.1:${port}`);
        });
      } finally {
        await new Promise((done) => taken.close(done));
      }
    });
  },
);

test(
  "SIGTERM and SIGINT stop the server cleanly, and a restart keeps its data",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "SIGTERM, as a container sends it, ends the server with exit 0 and closes the port. So does Ctrl-C. Both leave an audit checkpoint in the log. Starting again on the same schema keeps the signing key and the root account, and prints no setup token.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    await withSchema(async (schema) => {
      const port = await freePort();
      const settings = serveEnv(schema, {
        DOPGATE_PORT: String(port),
        DOPGATE_ROOT_EMAIL: "stop@example.com",
        DOPGATE_ROOT_PASSWORD: "a long enough password",
      });
      const first = await startServe([], { port, env: settings });
      let firstKey = "";
      try {
        await step("dopgate serve starts and answers", () => first.waitHealthy());
        firstKey = (await query<{ id: string }>(schema, "SELECT id FROM signing_keys"))[0]!.id;
      } finally {
        await step("SIGTERM ends it with exit 0", async () => {
          const ended = await first.stop("SIGTERM");
          expect(ended).toEqual({ code: 0, signal: null });
        });
      }
      await step("The port is closed and the log has the shutdown checkpoint", async () => {
        expect(await reaches(first.url)).toBe(false);
        const checkpoints = first.output().match(/audit checkpoint/g) ?? [];
        expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      });
      const second = await startServe([], { port, env: settings });
      try {
        await step("dopgate serve again on the same schema", () => second.waitHealthy());
        await step("The signing key and the root account are the same, and no setup token is printed", async () => {
          const keys = await query<{ id: string }>(schema, "SELECT id FROM signing_keys");
          expect(keys.map((key) => key.id)).toEqual([firstKey]);
          const admins = await query<{ email: string }>(schema, "SELECT email FROM admins");
          expect(admins).toEqual([{ email: "stop@example.com" }]);
          expect(second.output()).not.toContain("No root account yet.");
          expect(second.output()).not.toContain("Password:");
        });
      } finally {
        await step("SIGINT ends it with exit 0", async () => {
          const ended = await second.stop("SIGINT");
          expect(ended).toEqual({ code: 0, signal: null });
        });
      }
    });
  },
);

test(
  "DOPGATE_TRUSTED_PROXIES decides whose X-Forwarded-For counts",
  {
    tag: ["@security", "@limits"],
    annotation: about(
      "Behind a reverse proxy the visitor's address comes from X-Forwarded-For, but only from a proxy that is listed. A listed proxy's header is read from the right, so a visitor can't choose the address by adding entries of their own. Without the setting the header is ignored.",
    ),
  },
  async () => {
    recordHit("cli", "serve");
    await withSchema(async (schema) => {
      const serviceKey = newServiceKey();
      const start = async (extra: Record<string, string>) => {
        const port = await freePort();
        const server = await startServe([], {
          port,
          env: serveEnv(schema, { DOPGATE_PORT: String(port), DOPGATE_SERVICE_KEY: serviceKey, ...extra }),
        });
        await server.waitHealthy();
        return server;
      };
      const signedInFrom = async (server: Running, forwarded: string, email: string) => {
        const api = await ApiClient.create(server.url, "visitor", []);
        try {
          const login = await api.post(
            "/auth/login",
            { email, password: "a long enough password" },
            { headers: { "x-forwarded-for": forwarded }, record: false },
          );
          expect(login.status).toBe(200);
          const device = await ApiClient.create(server.url, "device", [], login.data.accessToken);
          try {
            const sessions = await device.get("/auth/sessions", { record: false });
            return sessions.data.find((item: { current: boolean }) => item.current).ipAddress as string;
          } finally {
            await device.dispose();
          }
        } finally {
          await api.dispose();
        }
      };
      const trusted = await start({ DOPGATE_TRUSTED_PROXIES: "127.0.0.1, 10.0.0.0/8" });
      try {
        const service = await ApiClient.create(trusted.url, "service", [], serviceKey);
        try {
          for (const email of ["proxy-a@example.com", "proxy-b@example.com"]) {
            await service.must(
              "POST",
              "/admin/users",
              { email, password: "a long enough password", emailVerified: true },
              { record: false },
            );
          }
        } finally {
          await service.dispose();
        }
        await step("From a listed proxy, the forwarded address is the visitor's", async () => {
          expect(await signedInFrom(trusted, "198.51.100.20", "proxy-a@example.com")).toBe("198.51.100.20");
        });
        await step("Entries the visitor added in front are not believed", async () => {
          expect(
            await signedInFrom(trusted, "203.0.113.99, 198.51.100.21, 10.1.2.3", "proxy-b@example.com"),
          ).toBe("198.51.100.21");
        });
      } finally {
        await stopAll(trusted);
      }
      const untrusting = await start({});
      try {
        await step("With no trusted proxies the header is ignored", async () => {
          expect(await signedInFrom(untrusting, "198.51.100.22", "proxy-a@example.com")).toMatch(
            /^(127\.0\.0\.1|::1)$/,
          );
        });
      } finally {
        await stopAll(untrusting);
      }
    });
  },
);
