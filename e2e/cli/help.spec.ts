import { readFileSync } from "node:fs";
import { about, expect, step, test, useServer } from "../harness/index.ts";
import { runCli } from "../harness/server.ts";

const app = useServer();
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

// The commands listed under "Commands:" in a help page.
function subcommands(help: string): string[] {
  const names: string[] = [];
  let inCommands = false;
  for (const line of help.split("\n")) {
    if (line === "Commands:") {
      inCommands = true;
      continue;
    }
    if (!inCommands) continue;
    if (line.trim() === "") break;
    const name = line.match(/^ {2}([a-z][a-z0-9-]*)\s/)?.[1];
    if (name) names.push(name);
  }
  return names;
}

test(
  "every command in the help tree parses",
  {
    tag: "@smoke",
    annotation: about(
      "Walks `dopgate --help` and `dopgate help <command>` down to every leaf and fails on any command path that errors.",
    ),
  },
  async () => {
    // runCli, not app.cli: asking for help is not a test of the command, so
    // the walk must not count toward coverage.
    const visited: string[] = [];
    const failures: string[] = [];
    const walk = async (path: string[]): Promise<void> => {
      const help = await runCli([...path, "--help"]);
      const viaHelp = await runCli(["help", ...path]);
      visited.push(path.join(" ") || "(root)");
      if (help.code !== 0) failures.push(`dopgate ${path.join(" ")} --help`);
      if (viaHelp.code !== 0) failures.push(`dopgate help ${path.join(" ")}`);
      for (const name of subcommands(help.stdout)) {
        if (name !== "help") await walk([...path, name]);
      }
    };

    await step(
      "dopgate --help, then dopgate <command> --help and dopgate help <command> for every command",
      async () => {
        await walk([]);
      },
    );
    await step("Every help page exits 0", async () => {
      await test.info().attach("command paths", {
        body: visited.join("\n"),
        contentType: "text/plain",
      });
      expect(failures).toEqual([]);
    });
    await step("The tree has the five commands people use", async () => {
      expect(visited).toEqual([
        "(root)",
        "serve",
        "init",
        "keys",
        "keys rotate",
        "admin",
        "admin reset-password",
        "healthcheck",
      ]);
    });
  },
);

test(
  "the version and a mistyped command",
  {
    tag: "@smoke",
    annotation: about(
      "`dopgate --version` prints the release version. A command that doesn't exist exits 2 and points at --help instead of doing something else.",
    ),
  },
  async () => {
    await step("dopgate --version prints the package version", async () => {
      const version = await app.cliRaw(["--version"], { record: false }).ok();
      expect(version.stdout.trim()).toBe(`dopgate ${pkg.version}`);
    });
    await step("dopgate nope exits 2 with a usage hint", async () => {
      const wrong = await app.cliRaw(["nope"], { record: false }).fails(2);
      expect(wrong.stderr).toContain("unrecognized subcommand 'nope'");
      expect(wrong.stderr).toContain("--help");
    });
  },
);
