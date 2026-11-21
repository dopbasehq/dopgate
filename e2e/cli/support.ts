// Helpers for the CLI specs of the platform area: a database schema of a
// test's own, a server started by hand from the binary, and a sign-in check on
// a server started on a given schema.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "../harness/api.ts";
import {
  binaryPath,
  cleanEnv,
  databaseUrl,
  dropSchema,
  freePort,
  newSchema,
  startServerIn,
  waitForHealth,
} from "../harness/server.ts";

/** What the binary needs to find one instance, with logging off. */
export function instanceEnv(schema: string): Record<string, string> {
  return {
    DOPGATE_DATABASE_URL: databaseUrl(),
    DOPGATE_DATABASE_SCHEMA: schema,
    DOPGATE_DATABASE_MAX_CONNECTIONS: "2",
    RUST_LOG: "off",
  };
}

/**
 * Runs `body` with the name of a schema nobody else uses and the env that
 * points the CLI at it. The schema is dropped afterwards, whatever happens.
 */
export async function withSchema<T>(
  body: (schema: string, env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const schema = newSchema();
  try {
    return await body(schema, instanceEnv(schema));
  } finally {
    await dropSchema(schema);
  }
}

/** A temporary folder, removed by the returned `remove`. */
export async function tempFolder(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), `dopgate-e2e-${prefix}-`));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** Writes a file into a temp folder and returns its path. */
export async function writeIn(dir: string, name: string, text: string) {
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}

/**
 * Starts the binary's server on `schema`, signs in at /console/login with
 * the given credentials, reads what the audit log says about setup, and stops
 * the server. Returns what the sign-in answered, whether the instance counts
 * as set up, and what the server logged.
 */
export async function consoleSignInOn(
  schema: string,
  email: string,
  password: string,
) {
  const folder = await tempFolder("signin");
  const server = await startServerIn(folder.dir, schema, { root: false });
  const anonymous = await ApiClient.create(server.url, "anonymous", []);
  const service = await ApiClient.create(
    server.url,
    "service key",
    [],
    server.serviceKey,
  );
  try {
    const signedIn = await anonymous.post(
      "/console/login",
      { email, password },
      { record: false },
    );
    const status = await anonymous.get("/bootstrap/status", { record: false });
    const setup = await service.get(
      "/admin/audit-events?action=instance.initialized",
      { record: false },
    );
    return {
      signedIn,
      initialized: status.data.initialized as boolean,
      setupEvents: setup.data.items as Record<string, any>[],
      log: await server.log(),
    };
  } finally {
    await anonymous.dispose();
    await service.dispose();
    await server.halt();
    await folder.remove();
  }
}

export type Running = {
  child: ChildProcess;
  port: number;
  url: string;
  /** Standard output and error so far. */
  output: () => string;
  /** Resolves when GET /health answers. Rejects if the process exits first. */
  waitHealthy: () => Promise<void>;
  /** Sends the signal and waits for the process to end. */
  stop: (
    signal?: NodeJS.Signals,
  ) => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

/**
 * Starts `dopgate serve` with exactly this env (and PATH) and arguments. The
 * caller says which port it will listen on, since a flag or a file may be
 * what sets it.
 */
export async function startServe(
  args: string[],
  opts: {
    env: Record<string, string>;
    port: number;
    cwd?: string;
  },
): Promise<Running> {
  const child = spawn(binaryPath(), ["serve", ...args], {
    env: cleanEnv({
      NO_COLOR: "1",
      RUST_LOG: "app=info,tower_http=info",
      ...opts.env,
    }),
    cwd: opts.cwd,
  });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  const url = `http://127.0.0.1:${opts.port}`;
  const ended = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((done) => child.once("close", (code, signal) => done({ code, signal })));
  return {
    child,
    port: opts.port,
    url,
    output: () => output,
    waitHealthy: async () => {
      await Promise.race([
        waitForHealth(url),
        ended.then(({ code }) => {
          throw new Error(`dopgate serve exited with ${code}:\n${output}`);
        }),
      ]);
    },
    stop: async (signal = "SIGTERM") => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      try {
        return await ended;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export { freePort };
