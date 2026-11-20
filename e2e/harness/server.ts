// Starts a real Dopgate server for end-to-end tests: the release binary on a
// free port, with its own PostgreSQL schema that is dropped afterwards.
//
// Only node: modules and the `postgres` client are used here, so the same
// code runs under Playwright (Node) and under Bun scripts such as
// e2e/coverage/check.ts.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { startBreachList, type BreachList } from "./breaches.ts";
import { startSmtp, type SmtpSink } from "./smtp.ts";

/** The email of the root account on every e2e server that has one. */
export const ROOT_EMAIL = "root@dopbase.com";
/** The password of root and of every account the harness creates. */
export const PASSWORD = "correct horse battery";
/**
 * A password the fake breach list always reports as leaked, for tests of
 * the leaked password check.
 */
export const LEAKED_PASSWORD = "sunshine-2019-leaked";

/** The database `bun run test:db` starts. */
export const DEFAULT_DATABASE_URL =
  "postgres://postgres@127.0.0.1:55432/postgres";

/**
 * The database the suites run against. Each server gets its own schema in
 * it. It is the Rust tests' database unless DOPGATE_E2E_DATABASE_URL names
 * another.
 */
export function databaseUrl(): string {
  return (
    process.env.DOPGATE_E2E_DATABASE_URL ??
    process.env.DOPGATE_TEST_DATABASE_URL ??
    DEFAULT_DATABASE_URL
  );
}

export type ServerOptions = {
  /** Extra env for the server process, e.g. `{ DOPGATE_ALLOWED_ORIGINS: "…" }`. */
  env?: Record<string, string>;
  /** Serve the OpenAPI document and Swagger UI. On unless set to false. */
  docs?: boolean;
  /** Serve the admin console. On unless set to false. */
  webUi?: boolean;
  /** Listen on this port instead of a free one. A taken port isn't retried. */
  port?: number;
  /**
   * Create the root account at startup. On unless set to false, which
   * leaves the instance waiting for its setup token (`server.setupToken()`).
   */
  root?: boolean;
  /** Start with a service key. On unless set to false. */
  serviceKey?: boolean;
  /**
   * Raise the per-address and per-email limits so a file full of sign-ins
   * isn't throttled. On unless set to false, which keeps the defaults
   * (20 requests a minute, 60 seconds between codes, 5 codes an hour).
   */
  relaxLimits?: boolean;
  /**
   * Where email goes. By default it is written to the server log. "env"
   * starts a fake SMTP server and names it in `DOPGATE_SMTP_URL`, which
   * locks SMTP to it.
   */
  smtp?: "env";
};

export type Server = {
  url: string;
  port: number;
  /** Temp folder holding the server log. */
  root: string;
  /** The PostgreSQL schema this server keeps its tables in. */
  schema: string;
  logPath: string;
  /** The service key, when the server was started with one. */
  serviceKey?: string;
  /** The fake Pwned Passwords list this server asks about new passwords. */
  breaches: BreachList;
  /** The fake SMTP server, when the server was started with `smtp: "env"`. */
  smtp?: SmtpSink;
  /**
   * Env for running the CLI (`init`, `keys rotate`) against this server's
   * database and schema.
   */
  cliEnv: Record<string, string>;
  /** Reads everything the server has written to stdout and stderr so far. */
  log: () => Promise<string>;
  /** The one-time setup token a server without root prints at startup. */
  setupToken: () => Promise<string>;
  /** Stops the process and keeps the schema and the log. */
  halt: () => Promise<void>;
  /** Stops the process, drops the schema and deletes `root`. */
  stop: () => Promise<void>;
};

/** The binary under test. Set DOPGATE_BIN to test a different build. */
export function binaryPath(): string {
  return (
    process.env.DOPGATE_BIN ??
    resolve(import.meta.dirname, "../../app/target/release/dopgate")
  );
}

// The server gets PATH and the values set here, nothing else. A DOPGATE_*
// variable in your shell must never reach a test.
export function cleanEnv(
  extra: Record<string, string>,
): Record<string, string> {
  return { PATH: process.env.PATH ?? "", ...extra };
}

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

/** A schema name no other server uses, e.g. `e2e_3f2a9c41d0b7`. */
export function newSchema(): string {
  return `e2e_${randomBytes(6).toString("hex")}`;
}

/** A service key no other server uses. Dopgate wants at least 32 characters. */
export function newServiceKey(): string {
  return `e2e_${randomBytes(24).toString("hex")}`;
}

function connect() {
  return postgres(databaseUrl(), {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
}

/** Fails with what to do when the test database isn't running. */
export async function requireDatabase(): Promise<void> {
  const sql = connect();
  try {
    await sql`SELECT 1`;
  } catch (error) {
    throw new Error(
      `PostgreSQL is not reachable at ${databaseUrl().replace(/:[^:@/]+@/, ":***@")}. ` +
        `Start it with \`bun run test:db\`, or set DOPGATE_E2E_DATABASE_URL.\n${String(error)}`,
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Drops a server's schema and everything in it. */
export async function dropSchema(schema: string): Promise<void> {
  if (!/^e2e_[a-z0-9_]+$/.test(schema)) {
    throw new Error(`Refusing to drop ${schema}: not an e2e schema`);
  }
  const sql = connect();
  try {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Every e2e schema in the database, e.g. ones a killed run left behind. */
export async function leftoverSchemas(): Promise<string[]> {
  const sql = connect();
  try {
    const rows = await sql<{ nspname: string }[]>`
      SELECT nspname FROM pg_namespace WHERE nspname LIKE 'e2e\_%' ORDER BY 1`;
    return rows.map((row) => row.nspname);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * Runs a query in a server's schema. For the few things no route can do,
 * such as making a code or a session look old.
 */
export async function query<T extends Record<string, unknown>>(
  schema: string,
  text: string,
  params: (string | number | boolean | null)[] = [],
): Promise<T[]> {
  if (!/^e2e_[a-z0-9_]+$/.test(schema)) {
    throw new Error(`Refusing to query ${schema}: not an e2e schema`);
  }
  const sql = connect();
  try {
    await sql.unsafe(`SET search_path TO "${schema}"`);
    return (await sql.unsafe(text, params)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 2 });
  }
}

// Resolves once the server answers health. Rejects with the boot output
// when the process exits first, e.g. on a bad setting or a taken port.
function waitForBoot(child: ChildProcess, url: string): Promise<void> {
  return new Promise((done, fail) => {
    let output = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) fail(error);
      else done();
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
    };
    const onExit = (code: number | null) =>
      finish(new Error(`Server exited with code ${code}:\n${output}`));
    const onError = (error: Error) =>
      finish(new Error(`Server failed to start: ${error.message}\n${output}`));
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
    waitForHealth(url).then(
      () => finish(),
      (error: Error) => finish(new Error(`${error.message}\n${output}`)),
    );
  });
}

export async function waitForHealth(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${url}/api/v1/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`Server at ${url} never became healthy`);
}

/** Lifts the limits that would throttle a spec file, through the admin API. */
async function relaxLimits(url: string, serviceKey: string): Promise<void> {
  const headers = {
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  const current = (await (
    await fetch(`${url}/api/v1/admin/settings`, { headers })
  ).json()) as { data: { limits: Record<string, number> } };
  const response = await fetch(`${url}/api/v1/admin/settings`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      limits: {
        ...current.data.limits,
        ipRequestsPerMinute: 10_000,
        codeResendSeconds: 0,
        codesPerHour: 100,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not relax the limits: ${response.status} ${await response.text()}`,
    );
  }
}

async function bootOnce(
  root: string,
  schema: string,
  opts: ServerOptions,
): Promise<Server> {
  const logPath = join(root, "server.log");
  const port = opts.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const serviceKey = opts.serviceKey === false ? undefined : newServiceKey();
  if (opts.relaxLimits !== false && !serviceKey) {
    throw new Error(
      "A server without a service key can't have its limits relaxed; pass relaxLimits: false too",
    );
  }

  await mkdir(root, { recursive: true });
  const breaches = await startBreachList([LEAKED_PASSWORD]);
  const smtp = opts.smtp === "env" ? await startSmtp() : undefined;
  // What the server and the CLI both need to find the same instance.
  const instanceEnv = {
    DOPGATE_DATABASE_URL: databaseUrl(),
    DOPGATE_DATABASE_SCHEMA: schema,
    // Many servers share one database, so each keeps a small pool.
    DOPGATE_DATABASE_MAX_CONNECTIONS: "5",
  };
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(binaryPath(), ["serve"], {
    env: cleanEnv({
      ...instanceEnv,
      DOPGATE_HOST: "127.0.0.1",
      DOPGATE_PORT: String(port),
      DOPGATE_PUBLIC_URL: url,
      DOPGATE_DOCS: String(opts.docs ?? true),
      DOPGATE_WEB_UI: String(opts.webUi ?? true),
      DOPGATE_LEAKED_PASSWORDS_URL: breaches.url,
      ...(serviceKey ? { DOPGATE_SERVICE_KEY: serviceKey } : {}),
      ...(opts.root === false
        ? {}
        : { DOPGATE_ROOT_EMAIL: ROOT_EMAIL, DOPGATE_ROOT_PASSWORD: PASSWORD }),
      ...(smtp
        ? {
            DOPGATE_SMTP_URL: `smtp://127.0.0.1:${smtp.port}?security=none`,
            DOPGATE_SMTP_FROM_EMAIL: "no-reply@dopbase.com",
          }
        : {}),
      NO_COLOR: "1",
      RUST_LOG: "app=info,tower_http=info",
      ...opts.env,
    }),
  });
  // "close" comes after the process exits and both pipes have ended, so no
  // output arrives after it. A failed spawn (e.g. ENOENT for a missing
  // binary) emits only "error": without a listener it would crash the
  // worker, and "close" would never come, so it settles `closed` too.
  const closed = new Promise<void>((done) => {
    child.once("close", () => done());
    child.on("error", (error) => {
      log.write(`spawn error: ${error.message}\n`);
      done();
    });
  });
  // One listener for the life of the server: it copies the output to the
  // log and keeps the pipes drained, or the server blocks once a pipe
  // buffer fills.
  const toLog = (chunk: Buffer) => log.write(chunk);
  child.stdout?.on("data", toLog);
  child.stderr?.on("data", toLog);

  // Once only: a second call waits for the first instead of ending the log twice.
  let stopping: Promise<void> | undefined;
  const stopChild = () =>
    (stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      await closed;
      await new Promise<void>((done) => log.end(done));
      await breaches.stop();
      await smtp?.stop();
    })());

  try {
    await waitForBoot(child, url);
    if (opts.relaxLimits !== false && serviceKey) {
      await relaxLimits(url, serviceKey);
    }
  } catch (error) {
    await stopChild();
    throw error;
  }

  const readLog = async () =>
    existsSync(logPath) ? await readFile(logPath, "utf8") : "";
  return {
    url,
    port,
    root,
    schema,
    logPath,
    serviceKey,
    breaches,
    smtp,
    cliEnv: instanceEnv,
    log: readLog,
    setupToken: async () => {
      const token = (await readLog()).match(/^(setup_\S+)$/m)?.[1];
      if (!token)
        throw new Error("The server log has no setup token; was root created?");
      return token;
    },
    halt: stopChild,
    stop: async () => {
      await stopChild();
      await dropSchema(schema);
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Starts a server with a new schema and a new temp folder for its log. */
export async function startServer(opts: ServerOptions = {}): Promise<Server> {
  await requireDatabase();
  const root = await mkdtemp(join(tmpdir(), "dopgate-e2e-"));
  const schema = newSchema();
  try {
    return await startServerIn(root, schema, opts);
  } catch (error) {
    await dropSchema(schema).catch(() => {});
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Starts a server on `schema`, with its log in `root`. Unlike `startServer`
 * the schema and the folder are the caller's: use `halt()` to stop it and
 * start it again later on the same data.
 */
export async function startServerIn(
  root: string,
  schema: string,
  opts: ServerOptions = {},
): Promise<Server> {
  // Another worker can take the same free port between the probe and the
  // bind, so a failed boot is retried on a new port.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await bootOnce(root, schema, opts);
    } catch (error) {
      lastError = error;
      if (opts.port || !String(error).includes("failed to bind")) break;
    }
  }
  throw lastError;
}

export type CliResult = { code: number | null; stdout: string; stderr: string };

export type RunOptions = {
  env?: Record<string, string>;
  /** Written to the command's standard input, which is then closed. */
  stdin?: string;
  timeoutMs?: number;
  /** false for calls that must not count toward coverage. */
  record?: boolean;
};

/** Runs the binary with `args` and nothing in its env but PATH and `env`. */
export async function runCli(
  args: string[],
  opts: RunOptions = {},
): Promise<CliResult> {
  const child = spawn(binaryPath(), args, {
    env: cleanEnv({ NO_COLOR: "1", ...opts.env }),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
  child.stdin.end();
  const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
  const [code] = (await once(child, "close")) as [number | null];
  clearTimeout(timer);
  return { code, stdout, stderr };
}
