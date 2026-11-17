// Deletes what test runs leave behind: the e2e report and results, page
// coverage, e2e and sandbox servers left in the temp folder, and e2e schemas
// left in the test database. Source code is never touched (e2e/coverage/ is
// the coverage checker, not output), so only what is listed here goes.
//
//   bun run clean:test [--dry-run]
//
// Stop any test run or sandbox first: their servers and schemas go with
// the rest.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { dropSchema, leftoverSchemas } from "../e2e/harness/server.ts";

const ROOT = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const TARGETS: [string, string][] = [
  [".e2e", "e2e report, traces, screenshots and videos"],
  ["ui/coverage", "console unit test coverage"],
];

const paths: { path: string; label: string }[] = [];
for (const [path, label] of TARGETS) {
  const full = join(ROOT, path);
  if (existsSync(full)) paths.push({ path: full, label });
}
// A failed run with E2E_KEEP, a sandbox started with --keep, or a run that
// was killed leaves its server folder here.
const temp = tmpdir();
for (const entry of readdirSync(temp)) {
  if (
    entry.startsWith("dopgate-e2e-") ||
    entry.startsWith("dopgate-sandbox-")
  )
    paths.push({ path: join(temp, entry), label: "server left in temp" });
}

// The same runs leave their schema in the database. Without a database
// there is nothing to drop.
let schemas: string[] = [];
try {
  schemas = await leftoverSchemas();
} catch {
  console.log("The test database is not running, so no schemas were checked.");
}

if (!paths.length && !schemas.length) {
  console.log("Nothing to clean.");
  process.exit(0);
}

for (const { path, label } of paths) {
  const shown = path.startsWith(ROOT) ? relative(ROOT, path) : path;
  console.log(`${dryRun ? "would delete" : "deleting"} ${shown} (${label})`);
  if (!dryRun) rmSync(path, { recursive: true, force: true });
}
for (const schema of schemas) {
  console.log(`${dryRun ? "would drop" : "dropping"} schema ${schema}`);
  if (!dryRun) await dropSchema(schema);
}
