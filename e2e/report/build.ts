// Builds .e2e/report/index.html from .e2e/last-run.json, .e2e/coverage.json
// and (when run through bun run test) .e2e/unit.json. The page is one HTML file
// with the data embedded; screenshots, videos and traces are linked from
// .e2e/results/ by relative path, so it opens from disk with no server.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CoverageData } from "../coverage/check.ts";
import type { RunData } from "../harness/reporter.ts";
import { PAGE } from "./page.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, ".e2e");

export type UnitLayer = {
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
};

function readJson<T>(file: string): T | undefined {
  const path = join(OUT, file);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as T)
    : undefined;
}

// The console's fonts, embedded so the report looks the same opened from
// disk or from a CI artifact: Fira Code for mono text and Geist for the
// wordmark. Without ui/node_modules the page falls back to system fonts.
const FONTS = "ui/node_modules/@fontsource-variable";
const FACES = [
  {
    family: "Fira Code Variable",
    weight: "300 700",
    file: "fira-code/files/fira-code-latin-wght-normal.woff2",
  },
  {
    family: "Geist Variable",
    weight: "100 900",
    file: "geist/files/geist-latin-wght-normal.woff2",
  },
];

function fontFace(): string {
  return FACES.map(({ family, weight, file }) => {
    const path = join(ROOT, FONTS, file);
    if (!existsSync(path)) return "";
    const data = readFileSync(path).toString("base64");
    return `@font-face { font-family: "${family}"; font-style: normal; font-display: swap; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
  }).join("\n");
}

export function buildReport(): string {
  const run = readJson<RunData>("last-run.json");
  const coverage = readJson<CoverageData>("coverage.json");
  const unit = readJson<{ layers: UnitLayer[] }>("unit.json");
  const data = {
    run: run ?? null,
    coverage: coverage ?? null,
    unit: unit?.layers ?? null,
  };
  // Embedded as JSON in a script tag; escape < so no value can close it.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  // A function, so `$&` and friends in test output aren't read as patterns.
  const html = PAGE.replace("/*__FONT_FACE__*/", () => fontFace()).replace(
    "/*__DATA__*/null",
    () => json,
  );
  const dir = join(OUT, "report");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.html");
  writeFileSync(file, html);
  return file;
}

if (import.meta.main) {
  const file = buildReport();
  console.log(`Report: ${pathToFileURL(file).href}`);
}
