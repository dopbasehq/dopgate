// Shared by the CLI helper and the coverage check, which runs under Bun
// and must not load Playwright.

// Options that take a value, written as `--name value`.
const WITH_VALUE = new Set([
  "--database-url",
  "--config",
  "--port",
  "--host",
  "--public-url",
  "--docs",
  "--web-ui",
  "--email",
]);

/**
 * Turns a CLI argv into its command words, without options, so
 * `--json keys rotate --database-url …` becomes `keys rotate`. Shared with
 * the coverage check.
 */
export function commandWords(args: string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (arg.startsWith("-")) {
      // An option written as `--name value` takes the next word with it.
      if (!arg.includes("=") && WITH_VALUE.has(arg)) i++;
      continue;
    }
    words.push(arg);
  }
  return words;
}
