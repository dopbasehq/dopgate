// Starts a Dopgate server for testing by hand, the way the e2e harness
// starts one for a spec file: the release binary, a free port and its own
// PostgreSQL schema. Prints where it runs, then waits for Ctrl+C.
//
//   bun run test:e2e:sandbox [--port N] [--empty] [--keep] [--skip-build]
//   bun run test:e2e:sandbox --from <dir>    a server E2E_KEEP kept
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureBinary } from "./binary.ts";
import {
  PASSWORD,
  ROOT_EMAIL,
  dropSchema,
  newSchema,
  requireDatabase,
  startServerIn,
  type Server,
  type ServerOptions,
} from "./harness/server.ts";

type Args = {
  port?: number;
  empty: boolean;
  keep: boolean;
  skipBuild: boolean;
  from?: string;
};

const USAGE = `Starts a Dopgate server for testing by hand.

  bun run test:e2e:sandbox [options]

  --port <n>      Listen on this port instead of a free one.
  --empty         Skip the sample users and the second admin.
  --keep          Keep the server's schema and log when you stop it.
  --from <dir>    Start a server E2E_KEEP kept after a failed test (its data stays).
  --skip-build    Use the release binary as it is.
  --help, -h      This text.`;

function parseArgs(argv: string[]): Args {
  const args: Args = { empty: false, keep: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg === "--empty") args.empty = true;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--skip-build") args.skipBuild = true;
    else if (arg === "--from") args.from = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown option ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  if (args.port !== undefined && !Number.isInteger(args.port)) {
    console.error("--port takes a number");
    process.exit(2);
  }
  return args;
}

const SAMPLE_ADMIN = "sam@dopbase.com";
const SAMPLE_USERS = [
  { email: "maya@dopbase.com", displayName: "Maya Okafor", emailVerified: true },
  { email: "leo@dopbase.com", displayName: "Leo Brandt", emailVerified: true },
  // Signed up but never confirmed the code.
  { email: "nina@dopbase.com", displayName: "Nina Hale", emailVerified: false },
];

/** Adds a second admin and a few users through the admin API. */
async function seed(server: Server): Promise<void> {
  const post = async (path: string, token: string, body: unknown) => {
    const response = await fetch(`${server.url}/api/v1${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `POST ${path} answered ${response.status}: ${await response.text()}`,
      );
    }
    return (await response.json()) as { data: any };
  };
  for (const user of SAMPLE_USERS) {
    await post("/admin/users", server.serviceKey!, {
      ...user,
      password: PASSWORD,
    });
  }
  // Only root can add admins, so this one goes through a console sign-in.
  const root = await post("/console/login", "", {
    email: ROOT_EMAIL,
    password: PASSWORD,
  });
  await post("/admin/admins", root.data.accessToken, {
    email: SAMPLE_ADMIN,
    password: PASSWORD,
    displayName: "Sam Rivera",
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipBuild) ensureBinary(false);
  await requireDatabase();

  // A kept server brings its schema and the options its spec file used.
  let root: string;
  let schema: string;
  let options: ServerOptions = {};
  if (args.from) {
    root = resolve(args.from);
    const file = join(root, "sandbox.json");
    if (!existsSync(file)) {
      console.error(`${root} has no sandbox.json, so it isn't a kept server.`);
      process.exit(2);
    }
    const kept = JSON.parse(readFileSync(file, "utf8")) as {
      schema: string;
      options?: ServerOptions;
    };
    schema = kept.schema;
    options = kept.options ?? {};
  } else {
    root = await mkdtemp(join(tmpdir(), "dopgate-sandbox-"));
    schema = newSchema();
  }
  const ownsData = !args.from && !args.keep;

  const server = await startServerIn(root, schema, {
    ...options,
    port: args.port ?? options.port,
  });
  const seeded = !args.from && !args.empty && options.root !== false;
  if (seeded) await seed(server);

  const stop = async () => {
    await server.halt();
    if (ownsData) {
      await dropSchema(schema);
      await rm(root, { recursive: true, force: true });
    } else {
      console.log(`\nThe schema ${schema} and ${root} are still there.`);
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const row = (label: string, value: string) =>
    `  ${label.padEnd(14)}${value}`;
  const lines = [
    "",
    "Dopgate sandbox is running.",
    "",
    row("Console", server.url),
    row("API", `${server.url}/api/v1`),
    row("API docs", `${server.url}/api/docs`),
    row("Key set", `${server.url}/.well-known/jwks.json`),
    row("Schema", schema),
    row("Server log", server.logPath),
    "",
  ];
  if (options.root === false) {
    lines.push(
      row("Root", "not created yet"),
      row("Setup token", await server.setupToken()),
    );
  } else if (!args.from) {
    lines.push(row("Root", `${ROOT_EMAIL} / ${PASSWORD}`));
  } else {
    lines.push(row("Root", `${ROOT_EMAIL}, with the password the test left`));
  }
  if (seeded) {
    lines.push(
      row("Admin", `${SAMPLE_ADMIN} / ${PASSWORD}`),
      row(
        "Users",
        `${SAMPLE_USERS.map((user) => user.email).join(", ")} / ${PASSWORD}`,
      ),
    );
  }
  if (server.serviceKey) lines.push(row("Service key", server.serviceKey));
  lines.push(
    "",
    "Emails are not sent. Each one, with its code, is in the server log.",
    "The leaked password list is a fake that knows one password: sunshine-2019-leaked.",
    "",
    ownsData
      ? "Ctrl+C stops the server and drops its schema. Start with --keep to keep it."
      : "Ctrl+C stops the server. Its schema stays.",
  );
  console.log(lines.join("\n"));
  // Keep running until Ctrl+C.
  await new Promise(() => {});
}

await main();
