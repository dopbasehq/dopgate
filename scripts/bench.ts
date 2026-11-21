// Measures how fast a Dopgate container answers sign-in, the agent token
// trade, refresh and the key set, with PostgreSQL 18 beside it on the same
// CPUs. docs/reference/benchmarks.md explains the method and has the
// published numbers.
//
//   bun run bench [options]
//
// Needs Docker and Bun. It builds the image from the Dockerfile, starts
// PostgreSQL and Dopgate, sends the load from this machine, prints a table
// and removes the containers again.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const ROOT = resolve(import.meta.dirname, "..");
const NETWORK = "dopgate-bench";
const PG = "dopgate-bench-pg";
const APP = "dopgate-bench-app";
const PROBE = "dopgate-bench-probe";
const PG_IMAGE = "postgres:18-alpine";
/** Worker threads the load is spread over, so one thread isn't the limit. */
const MAX_THREADS = 6;
/** Visitor addresses each thread rotates through. */
const ADDRESSES_PER_THREAD = 512;

const USAGE = `Benchmarks a Dopgate container with PostgreSQL 18 beside it.

  bun run bench [options]

  --cpuset <list>       CPUs both containers are pinned to. Default 0,1.
  --memory <size>       Memory limit of each container. Default 2g.
  --connections <list>  Requests in flight at once, one pass per value. Default 1,32.
  --seconds <n>         Measured seconds per run. Default 20.
  --warmup <n>          Seconds of load before measuring starts. Default 3.
  --runs <n>            Runs per pass. The median run is reported. Default 3.
  --only <list>         Only these: key-set, token-trade, refresh, sign-in.
  --image <tag>         Benchmark this image instead of building dopgate:bench.
  --env <KEY=VALUE>     Extra environment for the Dopgate container. Repeatable.
  --skip-build          Use the dopgate:bench image as it is.
  --json <file>         Also write every run to this file.
  --keep                Leave the containers running afterwards.
  --help, -h            This text.`;

// ---------------------------------------------------------------------------
// What a virtual client sends. This part runs in the worker threads.

type ScenarioName = "sign-in" | "token-trade" | "refresh" | "key-set";

type Client = {
  email: string;
  agentToken: string;
  refreshToken?: string;
};

type Job = {
  scenario: ScenarioName;
  url: string;
  serviceKey: string;
  password: string;
  thread: number;
  clients: Client[];
  warmupMs: number;
  measureMs: number;
};

type Done = {
  latencies: Float64Array;
  errors: number;
  /** The first few failures, so a broken run explains itself. */
  failures: string[];
};

let sent = 0;

/**
 * Headers a backend sends when it signs people in for them. Every request
 * names another visitor, so no address runs out of its per-minute budget.
 */
function relay(job: Job): Record<string, string> {
  const n = sent++ % ADDRESSES_PER_THREAD;
  return {
    "content-type": "application/json",
    "x-dopgate-backend-key": job.serviceKey,
    "x-dopgate-client-ip": `10.${job.thread}.${n >> 8}.${n & 255}`,
  };
}

function post(job: Job, path: string, body: unknown): Promise<Response> {
  return fetch(`${job.url}${path}`, {
    method: "POST",
    headers: relay(job),
    body: JSON.stringify(body),
  });
}

/** Reads the answer to its end and says whether it was a 200. */
async function finished(response: Response, failures: string[]): Promise<boolean> {
  if (response.status === 200) {
    await response.arrayBuffer();
    return true;
  }
  const text = await response.text();
  if (failures.length < 3) failures.push(`${response.status} ${text.slice(0, 200)}`);
  return false;
}

async function signIn(job: Job, client: Client): Promise<Response> {
  return post(job, "/api/v1/auth/login", {
    email: client.email,
    password: job.password,
  });
}

const SCENARIOS: Record<
  ScenarioName,
  {
    /** Runs once per client before the clock starts. */
    prepare?: (job: Job, client: Client) => Promise<void>;
    once: (job: Job, client: Client, failures: string[]) => Promise<boolean>;
  }
> = {
  "sign-in": {
    once: async (job, client, failures) =>
      finished(await signIn(job, client), failures),
  },
  "token-trade": {
    once: async (job, client, failures) =>
      finished(
        await post(job, "/api/v1/auth/token", { token: client.agentToken }),
        failures,
      ),
  },
  refresh: {
    // A refresh token works once, so each client keeps its own session and
    // sends the token the last answer gave it.
    prepare: async (job, client) => {
      const response = await signIn(job, client);
      if (!response.ok) {
        throw new Error(`Sign-in before refresh answered ${response.status}`);
      }
      const body = (await response.json()) as { data: { refreshToken: string } };
      client.refreshToken = body.data.refreshToken;
    },
    once: async (job, client, failures) => {
      const response = await post(job, "/api/v1/auth/refresh", {
        refreshToken: client.refreshToken,
      });
      if (response.status !== 200) return finished(response, failures);
      const body = (await response.json()) as { data: { refreshToken: string } };
      client.refreshToken = body.data.refreshToken;
      return true;
    },
  },
  "key-set": {
    once: async (job, _client, failures) =>
      finished(await fetch(`${job.url}/.well-known/jwks.json`), failures),
  },
};

/** One thread's share of the clients: prepare, wait for "go", then load. */
async function work(job: Job): Promise<void> {
  const port = parentPort!;
  const scenario = SCENARIOS[job.scenario];
  if (scenario.prepare) {
    // One at a time: getting ready is not part of the measurement.
    for (const client of job.clients) await scenario.prepare(job, client);
  }
  const go = new Promise<void>((start) => port.once("message", () => start()));
  port.postMessage({ ready: true });
  await go;

  let latencies = new Float64Array(1 << 16);
  let count = 0;
  let errors = 0;
  const failures: string[] = [];
  const measureFrom = performance.now() + job.warmupMs;
  const endAt = measureFrom + job.measureMs;

  const drive = async (client: Client) => {
    for (;;) {
      const started = performance.now();
      if (started >= endAt) return;
      let ok = false;
      try {
        ok = await scenario.once(job, client, failures);
      } catch (error) {
        if (failures.length < 3) failures.push(String(error));
        // A refused connection would otherwise spin.
        await Bun.sleep(10);
      }
      if (started < measureFrom) continue;
      if (!ok) {
        errors++;
        continue;
      }
      if (count === latencies.length) {
        const grown = new Float64Array(latencies.length * 2);
        grown.set(latencies);
        latencies = grown;
      }
      latencies[count++] = performance.now() - started;
    }
  };
  await Promise.all(job.clients.map(drive));

  const result: Done = { latencies: latencies.slice(0, count), errors, failures };
  port.postMessage(result, [result.latencies.buffer as ArrayBuffer]);
}

// ---------------------------------------------------------------------------
// The rest runs in the main thread: containers, sample accounts, the report.

type Args = {
  cpuset: string;
  memory: string;
  connections: number[];
  seconds: number;
  warmup: number;
  runs: number;
  only: ScenarioName[];
  image?: string;
  env: string[];
  skipBuild: boolean;
  json?: string;
  keep: boolean;
};

// Sign-in comes last: it is the heaviest, and the others then run on a
// server that hasn't hashed thousands of passwords yet.
const LABELS: Record<ScenarioName, string> = {
  "key-set": "GET /.well-known/jwks.json",
  "token-trade": "POST /api/v1/auth/token",
  refresh: "POST /api/v1/auth/refresh",
  "sign-in": "POST /api/v1/auth/login",
};

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cpuset: "0,1",
    memory: "2g",
    connections: [1, 32],
    seconds: 20,
    warmup: 3,
    runs: 3,
    only: Object.keys(LABELS) as ScenarioName[],
    env: [],
    skipBuild: false,
    keep: false,
  };
  const number = (flag: string, value: string | undefined): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) fail(`${flag} takes a whole number above 0`);
    return parsed;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => argv[++i] ?? fail(`${arg} needs a value\n\n${USAGE}`);
    if (arg === "--cpuset") args.cpuset = value();
    else if (arg === "--memory") args.memory = value();
    else if (arg === "--connections")
      args.connections = value()
        .split(",")
        .map((part) => number(arg, part));
    else if (arg === "--seconds") args.seconds = number(arg, value());
    else if (arg === "--warmup") args.warmup = number(arg, value());
    else if (arg === "--runs") args.runs = number(arg, value());
    else if (arg === "--only") {
      args.only = value().split(",") as ScenarioName[];
      for (const name of args.only) {
        if (!(name in LABELS)) fail(`Unknown scenario ${name}\n\n${USAGE}`);
      }
    } else if (arg === "--image") args.image = value();
    else if (arg === "--env") args.env.push(value());
    else if (arg === "--skip-build") args.skipBuild = true;
    else if (arg === "--json") args.json = value();
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else fail(`Unknown option ${arg}\n\n${USAGE}`);
  }
  return args;
}

/** Runs docker and returns what it printed. Throws with its error output. */
function docker(args: string[], inherit = false): string {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    stdio: inherit ? "inherit" : "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Could not run docker: ${result.error.message}. Is Docker installed and running?`);
  }
  if (result.status !== 0) {
    throw new Error(`docker ${args.slice(0, 2).join(" ")} failed:\n${String(result.stderr ?? "")}`);
  }
  return String(result.stdout ?? "").trim();
}

function removeContainers(): void {
  spawnSync("docker", ["rm", "-f", PROBE, APP, PG], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", NETWORK], { stdio: "ignore" });
}

function freePort(): Promise<number> {
  return new Promise((done, failed) => {
    const probe = createServer();
    probe.on("error", failed);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

async function until(what: string, check: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if (await check()) return;
    } catch {
      // Not there yet.
    }
    await Bun.sleep(250);
  }
  throw new Error(`${what} did not come up within a minute`);
}

/** Stops the benchmark when the Dopgate container is gone, and says why. */
function requireRunning(): void {
  const state = spawnSync(
    "docker",
    ["inspect", APP, "--format", "{{.State.Running}} {{.State.OOMKilled}} {{.State.ExitCode}}"],
    { stdio: "pipe" },
  );
  const [running, outOfMemory, code] = String(state.stdout).trim().split(" ");
  if (running === "true") return;
  throw new Error(
    outOfMemory === "true"
      ? "The Dopgate container ran out of memory and was stopped. Raise --memory or lower --connections."
      : `The Dopgate container stopped with exit code ${code}.`,
  );
}

type Sample = { at: number; values: number[] };

/**
 * Follows a shell loop in a container that prints a line of numbers every
 * quarter second. The loop uses shell builtins only, so it costs the
 * container next to nothing.
 */
class Sampler {
  samples: Sample[] = [];
  private child;

  constructor(dockerArgs: string[], loop: string) {
    this.child = spawn("docker", [...dockerArgs, `while :; do ${loop}; sleep 0.25; done`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let rest = "";
    this.child.stdout.on("data", (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const values = line.trim().split(/\s+/).map(Number);
        if (values.every(Number.isFinite)) {
          this.samples.push({ at: performance.now(), values });
        }
      }
    });
  }

  last(): number[] | undefined {
    return this.samples.at(-1)?.values;
  }

  /** The samples taken between two moments, with the one just before. */
  between(from: number, to: number): Sample[] {
    const first = this.samples.findLastIndex((sample) => sample.at <= from);
    return this.samples
      .slice(Math.max(first, 0))
      .filter((sample) => sample.at <= to);
  }

  stop(): void {
    this.child.kill("SIGKILL");
  }
}

type Run = {
  rps: number;
  p50: number;
  p99: number;
  max: number;
  requests: number;
  errors: number;
  failures: string[];
  /** CPU cores the Dopgate process used on average. */
  dopgateCores: number | null;
  /** CPU cores the PostgreSQL container used on average. */
  postgresCores: number | null;
  /** The highest resident memory of the Dopgate process, in MiB. */
  dopgatePeakMib: number | null;
  /** The highest memory of the PostgreSQL container, in MiB. */
  postgresPeakMib: number | null;
};

type Probes = { dopgate: Sampler; postgres: Sampler };

function quantile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}

function rate(samples: Sample[], column: number, perSecond: number): number | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.at <= first.at) return null;
  const used = (last.values[column]! - first.values[column]!) / perSecond;
  return used / ((last.at - first.at) / 1000);
}

function peak(samples: Sample[], column: number, perMib: number): number | null {
  if (!samples.length) return null;
  return Math.max(...samples.map((sample) => sample.values[column]!)) / perMib;
}

async function runOnce(
  scenario: ScenarioName,
  connections: number,
  base: Omit<Job, "scenario" | "thread" | "clients">,
  clients: Client[],
  probes: Probes,
): Promise<Run> {
  const threads = Math.min(connections, MAX_THREADS);
  const shares: Client[][] = Array.from({ length: threads }, () => []);
  clients.slice(0, connections).forEach((client, index) => {
    shares[index % threads]!.push({ ...client });
  });

  const started = shares.map((share, thread) => {
    const job: Job = { ...base, scenario, thread, clients: share };
    const worker = new Worker(import.meta.filename, { workerData: job });
    const ready = new Promise<void>((done, failed) => {
      worker.once("message", () => done());
      worker.once("error", failed);
    });
    return { worker, ready };
  });
  await Promise.all(started.map((thread) => thread.ready));

  const results = started.map(
    ({ worker }) =>
      new Promise<Done>((done, failed) => {
        worker.once("message", (result: Done) => done(result));
        worker.once("error", failed);
      }),
  );
  const from = performance.now() + base.warmupMs;
  for (const { worker } of started) worker.postMessage("go");
  const parts = await Promise.all(results);
  const to = from + base.measureMs;
  for (const { worker } of started) await worker.terminate();

  const total = parts.reduce((sum, part) => sum + part.latencies.length, 0);
  const latencies = new Float64Array(total);
  let offset = 0;
  for (const part of parts) {
    latencies.set(part.latencies, offset);
    offset += part.latencies.length;
  }
  latencies.sort();

  const dopgate = probes.dopgate.between(from, to);
  const postgres = probes.postgres.between(from, to);
  return {
    rps: total / (base.measureMs / 1000),
    p50: quantile(latencies, 0.5),
    p99: quantile(latencies, 0.99),
    max: latencies.at(-1) ?? Number.NaN,
    requests: total,
    errors: parts.reduce((sum, part) => sum + part.errors, 0),
    failures: parts.flatMap((part) => part.failures).slice(0, 3),
    // /proc/1/stat counts CPU time in hundredths of a second.
    dopgateCores: rate(dopgate, 1, 100),
    postgresCores: rate(postgres, 0, 1_000_000),
    dopgatePeakMib: peak(dopgate, 0, 1024),
    postgresPeakMib: peak(postgres, 1, 1024 * 1024),
  };
}

async function api(
  url: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<any> {
  const response = await fetch(`${url}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return ((await response.json()) as { data: unknown }).data;
}

/** The settings the run needs, and what they were changed to. */
async function configure(url: string, serviceKey: string): Promise<Record<string, unknown>> {
  const current = await api(url, "GET", "/admin/settings", serviceKey);
  const changed = {
    // The highest value the setting takes. Sign-in and token trade share it.
    limits: { ...current.limits, ipRequestsPerMinute: 10_000 },
    // Users make the agents whose tokens are traded.
    selfService: { ...current.selfService, agents: true },
    // Creating the sample users must not ask an outside service about their
    // passwords. Signing in never asks, so no measured request changes.
    password: { ...current.password, rejectLeaked: false },
  };
  await api(url, "PATCH", "/admin/settings", serviceKey, changed);
  return {
    "limits.ipRequestsPerMinute": 10_000,
    "selfService.agents": true,
    "password.rejectLeaked": false,
  };
}

/** One verified user per connection, each with an agent of its own. */
async function seed(
  url: string,
  serviceKey: string,
  password: string,
  count: number,
): Promise<Client[]> {
  const clients: Client[] = [];
  for (let index = 0; index < count; index++) {
    const email = `bench-${index}@example.com`;
    await api(url, "POST", "/admin/users", serviceKey, {
      email,
      password,
      displayName: `Bench ${index}`,
      emailVerified: true,
    });
    const tokens = await api(url, "POST", "/auth/login", "", { email, password }, {
      "x-dopgate-backend-key": serviceKey,
      "x-dopgate-client-ip": `10.250.${index >> 8}.${index & 255}`,
    });
    const agent = await api(url, "POST", "/auth/agents", tokens.accessToken, {
      name: "bench",
      description: "Trades its token during the benchmark.",
      capabilities: { repo: "dopgate", can_merge: false },
    });
    clients.push({ email, agentToken: agent.token });
  }
  return clients;
}

function commandOutput(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "pipe" });
  return result.status === 0 ? String(result.stdout).trim() : "";
}

function ms(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value < 10) return `${value.toFixed(2)} ms`;
  if (value < 100) return `${value.toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

function whole(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function optional(value: number | null, digits: number, unit = ""): string {
  return value === null ? "n/a" : `${value.toFixed(digits)}${unit}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const image = args.image ?? "dopgate:bench";
  const version = (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { version: string })
    .version;

  docker(["version", "--format", "{{.Server.Version}}"]);
  if (!args.image && !args.skipBuild) {
    console.log("Building the dopgate:bench image (the first build takes a few minutes)…");
    docker(["build", "-t", image, "."], true);
  }

  removeContainers();
  let stopping = false;
  const probes: Partial<Probes> = {};
  const cleanUp = () => {
    probes.dopgate?.stop();
    probes.postgres?.stop();
    if (args.keep) {
      console.log(`\nThe containers ${APP} and ${PG} are still running.`);
    } else {
      removeContainers();
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      cleanUp();
      process.exit(130);
    });
  }

  try {
    const report = await measure(args, image, version, probes);
    if (args.json) {
      writeFileSync(resolve(args.json), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`\nEvery run is in ${args.json}.`);
    }
    cleanUp();
    if (report.results.some((result) => result.errors > 0)) {
      console.error("\nSome requests failed, so these numbers are not a clean run.");
      process.exit(1);
    }
  } catch (error) {
    stopping = true;
    cleanUp();
    throw error;
  }
}

async function measure(args: Args, image: string, version: string, probes: Partial<Probes>) {
  const limits = [
    "--cpuset-cpus", args.cpuset,
    "--memory", args.memory,
    "--memory-swap", args.memory,
  ];
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const serviceKey = `bench_${randomBytes(24).toString("hex")}`;
  const password = `bench-${randomBytes(12).toString("hex")}`;

  console.log(`Starting PostgreSQL and Dopgate on CPUs ${args.cpuset}, ${args.memory} of memory each…`);
  docker(["network", "create", NETWORK]);
  docker([
    "run", "-d", "--name", PG, "--network", NETWORK, ...limits,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    PG_IMAGE,
  ]);
  await until("PostgreSQL", () =>
    spawnSync("docker", ["exec", PG, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]).status === 0,
  );
  docker([
    "run", "-d", "--name", APP, "--network", NETWORK, ...limits,
    "-p", `127.0.0.1:${port}:8850`,
    "-e", `DOPGATE_DATABASE_URL=postgres://postgres@${PG}:5432/postgres`,
    "-e", `DOPGATE_PUBLIC_URL=${url}`,
    "-e", `DOPGATE_SERVICE_KEY=${serviceKey}`,
    "-e", "DOPGATE_ROOT_EMAIL=root@example.com",
    "-e", `DOPGATE_ROOT_PASSWORD=${password}`,
    ...args.env.flatMap((pair) => ["-e", pair]),
    image,
  ]);
  let health: { version?: string } = {};
  try {
    await until("Dopgate", async () => {
      const response = await fetch(`${url}/api/v1/health`);
      if (!response.ok) return false;
      health = ((await response.json()) as { data: { version?: string } }).data;
      return true;
    });
  } catch (error) {
    console.error(spawnSync("docker", ["logs", "--tail", "40", APP], { stdio: "pipe" }).stderr.toString());
    throw error;
  }

  // The Dopgate image has no shell, so a second container that shares its
  // process list reads the process's memory and CPU time from /proc.
  probes.dopgate = new Sampler(
    [
      "run", "--rm", "-i", "--name", PROBE,
      "--pid", `container:${APP}`, "--network", "none",
      "--entrypoint", "sh", PG_IMAGE, "-c",
    ],
    'rss=0; while read -r key value _; do [ "$key" = VmRSS: ] && rss=$value; done < /proc/1/status; ' +
      'read -r stat < /proc/1/stat; set -- $stat; echo "$rss $((${14} + ${15}))"',
  );
  probes.postgres = new Sampler(
    ["exec", PG, "sh", "-c"],
    'read -r _ usage < /sys/fs/cgroup/cpu.stat; read -r memory < /sys/fs/cgroup/memory.current; echo "$usage $memory"',
  );
  const all = probes as Probes;
  await until("The memory probe", () => all.dopgate.samples.length > 0);

  await Bun.sleep(5000);
  const idleMib = all.dopgate.last()![0]! / 1024;
  console.log(`Dopgate ${health.version ?? version} is up. At rest it holds ${idleMib.toFixed(1)} MiB.`);

  const settings = await configure(url, serviceKey);
  const users = Math.max(...args.connections);
  console.log(`Creating ${users} users, each with an agent…`);
  const clients = await seed(url, serviceKey, password, users);

  const base = {
    url,
    serviceKey,
    password,
    warmupMs: args.warmup * 1000,
    measureMs: args.seconds * 1000,
  };
  const results: (Run & { scenario: ScenarioName; endpoint: string; connections: number; runs: Run[] })[] = [];
  for (const scenario of args.only) {
    for (const connections of args.connections) {
      const runs: Run[] = [];
      for (let attempt = 1; attempt <= args.runs; attempt++) {
        const run = await runOnce(scenario, connections, base, clients, all);
        runs.push(run);
        console.log(
          `  ${scenario}, ${connections} in flight, run ${attempt}/${args.runs}: ` +
            `${whole(run.rps)} req/s, p50 ${ms(run.p50)}, p99 ${ms(run.p99)}, ` +
            `Dopgate memory up to ${optional(run.dopgatePeakMib, 0, " MiB")}` +
            (run.errors ? `, ${run.errors} failed (${run.failures[0] ?? "no answer"})` : ""),
        );
        if (run.errors) requireRunning();
        await Bun.sleep(2000);
      }
      const median = [...runs].sort((a, b) => a.rps - b.rps)[Math.floor(runs.length / 2)]!;
      results.push({
        scenario,
        endpoint: LABELS[scenario],
        connections,
        ...median,
        errors: runs.reduce((sum, run) => sum + run.errors, 0),
        runs,
      });
    }
  }

  await Bun.sleep(10_000);
  const afterMib = all.dopgate.last()![0]! / 1024;
  const peakMib = Math.max(...all.dopgate.samples.map((sample) => sample.values[0]!)) / 1024;

  const report = {
    date: new Date().toISOString(),
    dopgate: {
      version: health.version ?? version,
      commit: commandOutput("git", ["rev-parse", "--short", "HEAD"]),
      uncommittedChanges: commandOutput("git", ["status", "--porcelain", "--", "app", "ui", "Dockerfile"]) !== "",
      image,
    },
    postgres: docker(["exec", PG, "psql", "-U", "postgres", "-tAc", "show server_version"]),
    host: {
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      memoryGib: Math.round(totalmem() / 2 ** 30),
      os: commandOutput("sw_vers", ["-productVersion"])
        ? `macOS ${commandOutput("sw_vers", ["-productVersion"])}`
        : commandOutput("uname", ["-sr"]),
      docker: docker(["info", "--format", "{{.OperatingSystem}}, Docker {{.ServerVersion}}, Linux {{.KernelVersion}}, {{.Architecture}}"]),
      bun: Bun.version,
    },
    containers: { cpuset: args.cpuset, memoryEach: args.memory, extraEnv: args.env },
    load: {
      seconds: args.seconds,
      warmupSeconds: args.warmup,
      runs: args.runs,
      threads: MAX_THREADS,
      visitorAddresses: MAX_THREADS * ADDRESSES_PER_THREAD,
    },
    settings,
    memoryMib: { atRest: idleMib, atRestAfterLoad: afterMib, peak: peakMib },
    results,
  };

  console.log(`
Dopgate ${report.dopgate.version} (${report.dopgate.commit}${report.dopgate.uncommittedChanges ? ", with uncommitted changes" : ""}), PostgreSQL ${report.postgres}
${report.host.cpu}, ${report.host.cores} cores, ${report.host.memoryGib} GB, ${report.host.os}
${report.host.docker}
Containers pinned to CPUs ${args.cpuset} with ${args.memory} each. ${args.seconds} s per run, median of ${args.runs}.

| Endpoint | In flight | Requests/s | p50 | p99 | Dopgate CPU | PostgreSQL CPU | Dopgate memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const result of results) {
    console.log(
      `| \`${result.endpoint}\` | ${result.connections} | ${whole(result.rps)} | ${ms(result.p50)} | ${ms(result.p99)} | ` +
        `${optional(result.dopgateCores, 2, " cores")} | ${optional(result.postgresCores, 2, " cores")} | ` +
        `${optional(result.dopgatePeakMib, 0, " MiB")} |`,
    );
  }
  console.log(`
Dopgate memory at rest: ${idleMib.toFixed(1)} MiB after startup, ${afterMib.toFixed(1)} MiB ten seconds after the last run. Highest during the runs: ${peakMib.toFixed(0)} MiB.`);
  return report;
}

if (isMainThread) {
  await main();
} else {
  await work(workerData as Job);
}
