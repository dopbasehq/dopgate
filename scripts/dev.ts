// Local development defaults. `bun run dev:db` starts this database.
process.env.DOPGATE_DATABASE_URL ??= "postgres://postgres:dopgate@localhost:55433/postgres";
process.env.DOPGATE_ROOT_EMAIL ??= "admin@example.com";

type ChildName = "dopgate API" | "Docs";

type Child = {
  name: ChildName;
  process: Bun.Subprocess;
};

const children: Child[] = [
  {
    name: "dopgate API",
    process: Bun.spawn(["bun", "run", "dev:app"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  },
  {
    name: "Docs",
    process: Bun.spawn(["bun", "run", "dev:docs"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  },
];

console.log("dopgate development servers starting:");
console.log("  API:      http://localhost:8850/api/v1");
console.log("  API docs: http://localhost:8850/api/docs");
console.log("  Docs:     http://localhost:5173");
console.log("  Database: " + process.env.DOPGATE_DATABASE_URL + " (start it with `bun run dev:db`)");

let stopping = false;

async function stop(signal: NodeJS.Signals, exitCode: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    for (const child of children) {
      if (child.process.exitCode === null) {
        child.process.kill(signal);
      }
    }
    await Promise.all(children.map((child) => child.process.exited));
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => void stop("SIGINT", 0));
process.on("SIGTERM", () => void stop("SIGTERM", 0));

const firstExit = await Promise.race(
  children.map(async (child) => ({
    name: child.name,
    exitCode: await child.process.exited,
  })),
);

if (!stopping) {
  console.error(
    `${firstExit.name} exited with code ${firstExit.exitCode}. Stopping development.`,
  );
  await stop("SIGTERM", firstExit.exitCode ?? 1);
}
