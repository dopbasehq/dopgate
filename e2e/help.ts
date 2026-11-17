// Prints what the test runner can do: the test scripts in the root
// package.json, the flags e2e/run.ts takes, the tags you can --grep for and
// where a run leaves its files.
//
//   bun run test:e2e:help
//   bun run test:e2e --help
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const E2E = join(ROOT, "e2e");
const SUITES = ["cli", "api", "ui", "journeys"];

// One line per test script. A test script missing here still shows in the
// list, marked so someone adds its line.
const SCRIPTS: Record<string, string> = {
  test: "Console unit tests, then Rust tests. No e2e.",
  "test:ui": "Console unit tests (Vitest).",
  "test:app": "Rust unit and integration tests.",
  "test:db":
    "Starts the test PostgreSQL container on port 55432. The Rust tests and the e2e suites both use it.",
  "test:e2e":
    "Every e2e suite, then the coverage check and the HTML report. Rebuilds the release binary first if its sources changed.",
  "test:e2e:help": "This list.",
  "test:e2e:sandbox":
    "Starts a server to click through by hand, on its own schema. --help for its options.",
  "test:e2e:cli": "CLI suite only: runs the dopgate binary, no browser.",
  "test:e2e:api": "API suite only: calls /api/v1 routes, no browser.",
  "test:e2e:ui": "Console suite only, in Chromium.",
  "test:e2e:journeys":
    "Journeys only: whole tasks across the CLI, the API and the browser, each one recorded on video.",
  "test:e2e:coverage":
    "Coverage check on its own, against the results of the last run.",
  "test:e2e:report": "Opens the HTML report from the last run.",
  "test:github": "Tests for the pull request template check and the release scripts.",
  "clean:test":
    "Deletes test output: .e2e/, servers left in the temp folder and e2e schemas left in the database. --dry-run lists them first.",
};

const FLAGS: [string, string][] = [
  ["--agent", "Short summary: one line per suite, then each failure."],
  [
    "--project <suite>",
    "Run one suite: cli, api, ui or journeys. Repeat it for more than one.",
  ],
  [
    "--grep <text>",
    "Run tests whose title or tag matches, e.g. --grep @smoke.",
  ],
  ["--skip-build", "Use the release binary as it is, even if it looks stale."],
  [
    "--keep",
    "When a test fails, keep its server's schema and log and print how to start it again in the sandbox.",
  ],
  ["--open", "Open the report when the run ends."],
  ["--help, -h", "This list."],
  [
    "-- <args>",
    "Anything after -- goes straight to Playwright, e.g. -- --headed or -- --debug.",
  ],
];

const ENV: [string, string][] = [
  ["DOPGATE_BIN=<path>", "Test this binary instead of building one."],
  [
    "DOPGATE_E2E_DATABASE_URL=<url>",
    "Use this PostgreSQL instead of the test:db container.",
  ],
  ["CI=1", "Two workers and one retry, as in CI."],
  ["E2E_KEEP=1", "The same as --keep."],
];

const EXAMPLES: [string, string][] = [
  ["bun run test:e2e --agent", "the usual regression run"],
  ["bun run test:e2e:api --grep @smoke", "one area of one suite"],
  [
    "bun run test:e2e --project ui --skip-build -- --headed",
    "watch the console suite in a real window",
  ],
  [
    "bun run test:e2e --project journeys --grep 'first day' -- --debug",
    "step through one journey in the Playwright inspector",
  ],
  [
    "e2e/node_modules/.bin/playwright show-trace .e2e/results/<test>/trace.zip",
    "replay a failed test action by action",
  ],
  ["bun run test:e2e:sandbox", "a server to click through"],
  [
    "bun run test:e2e:api --keep",
    "then bun run test:e2e:sandbox --from <dir> on a failure",
  ],
];

const OUTPUT: [string, string][] = [
  [".e2e/report/index.html", "the report (bun run test:e2e:report opens it)"],
  [".e2e/results/", "traces, screenshots and videos"],
  [".e2e/last-run.json", "raw results of the last run"],
  [".e2e/coverage.json", "what each command, route and page was hit by"],
];

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[22m` : s);

function wrap(text: string, width: number, indent: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join(`\n${" ".repeat(indent)}`);
}

function table(rows: [string, string][]): string {
  const pad = Math.min(Math.max(...rows.map(([left]) => left.length)) + 2, 36);
  const width = Math.max((process.stdout.columns ?? 100) - pad - 2, 40);
  return rows
    .map(([left, right]) => {
      const head =
        left.length + 2 > pad
          ? `  ${left}\n${" ".repeat(pad + 2)}`
          : `  ${left.padEnd(pad)}`;
      return head + wrap(right, width, pad + 2);
    })
    .join("\n");
}

/** Every tag used in a spec file, with how many tests carry it. */
function tags(): [string, number][] {
  const counts = new Map<string, number>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".spec.ts")) {
        const source = readFileSync(path, "utf8");
        for (const match of source.matchAll(
          /tag:\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/g,
        )) {
          for (const tag of match[1]!.match(/@[\w-]+/g) ?? [])
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
  };
  for (const suite of SUITES) walk(join(E2E, suite));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function printHelp(): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scripts = Object.keys(pkg.scripts)
    .filter(
      (name) =>
        name === "clean:test" ||
        ["test"].some(
          (p) => name === p || name.startsWith(`${p}:`),
        ),
    )
    .map((name): [string, string] => [
      `bun run ${name}`,
      SCRIPTS[name] ?? dim("No description yet. Add one in e2e/help.ts."),
    ]);
  const tagList = tags();

  const out = [
    bold("Dopgate tests"),
    "",
    "The e2e suites drive the release binary the way people use Dopgate: the",
    "CLI, the HTTP API and the admin console in Chromium. Start with",
    "bun run test:e2e --agent.",
    "",
    bold("Scripts"),
    table(scripts),
    "",
    bold("test:e2e flags") + dim("  (the one-suite scripts take them too)"),
    table(FLAGS),
    "",
    bold("Environment"),
    table(ENV),
    "",
    bold("Tags for --grep") + dim(`  (tests per tag)`),
    wrap(
      // A no-break space keeps each tag on the same line as its count.
      tagList.map(([tag, n]) => `${tag} ${dim(String(n))}`).join("  "),
      (process.stdout.columns ?? 100) - 4,
      2,
    ).replace(/^/, "  "),
    "",
    bold("Examples"),
    table(EXAMPLES),
    "",
    bold("Where a run leaves its files"),
    table(OUTPUT),
    "",
    dim("How to write a spec: e2e/README.md"),
  ];
  console.log(out.join("\n"));
}

if (import.meta.main) printHelp();
