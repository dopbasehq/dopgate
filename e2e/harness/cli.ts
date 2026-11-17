// Runs the CLI for a test: records the coverage hit and attaches the output
// to the test.
import { expect, test } from "@playwright/test";
import { recordHit } from "./record.ts";
import { runCli, type CliResult, type RunOptions } from "./server.ts";

export { commandWords } from "./words.ts";

const MAX_ATTACHED = 4_000;

function clip(text: string): string {
  return text.length > MAX_ATTACHED
    ? `${text.slice(0, MAX_ATTACHED)}\n… ${text.length - MAX_ATTACHED} more characters`
    : text;
}

/** A CLI call. Await it for the raw result, or use one of the helpers. */
export class CliRun implements PromiseLike<CliResult> {
  readonly args: string[];
  private readonly result: Promise<CliResult>;

  constructor(args: string[], opts: RunOptions) {
    this.args = args;
    if (opts.record !== false) recordHit("cli", args.join(" "));
    this.result = runCli(args, opts).then(async (result) => {
      try {
        await test.info().attach(`cli: dopgate ${args.join(" ")}`, {
          body: `$ dopgate ${args.join(" ")}\nexit ${result.code}\n\n--- stdout\n${clip(result.stdout)}\n--- stderr\n${clip(result.stderr)}`,
          contentType: "text/plain",
        });
      } catch {
        // Outside a test: nothing to attach to.
      }
      return result;
    });
  }

  then<A = CliResult, B = never>(
    onfulfilled?: ((value: CliResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.result.then(onfulfilled, onrejected);
  }

  /** Asserts exit code 0 and returns the result. */
  async ok(): Promise<CliResult> {
    const result = await this.result;
    expect(
      result.code,
      `dopgate ${this.args.join(" ")} should exit 0\n${result.stderr}`,
    ).toBe(0);
    return result;
  }

  /** Asserts a non-zero exit (or exactly `code`) and returns the result. */
  async fails(code?: number): Promise<CliResult> {
    const result = await this.result;
    if (code === undefined) {
      expect(
        result.code,
        `dopgate ${this.args.join(" ")} should fail\n${result.stdout}`,
      ).not.toBe(0);
    } else {
      expect(result.code, result.stderr).toBe(code);
    }
    return result;
  }

  /** Asserts success and parses standard output as JSON. */
  async json<T = any>(): Promise<T> {
    const out = (await this.ok()).stdout.trim();
    try {
      return JSON.parse(out) as T;
    } catch {
      throw new Error(
        `dopgate ${this.args.join(" ")} did not print JSON:\n${out}`,
      );
    }
  }
}
