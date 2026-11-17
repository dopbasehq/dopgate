// A stand-in for the Pwned Passwords range API, modelled on
// app/tests/support/breaches.rs. Every e2e server asks it about new
// passwords (DOPGATE_LEAKED_PASSWORDS_URL), so no test reaches the internet
// and a test can decide which passwords count as leaked.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** One lookup the server made. */
export type Lookup = {
  /** The five hash characters it asked for. */
  prefix: string;
  /** Its `Add-Padding` header. */
  padding: string | undefined;
};

export type BreachList = {
  url: string;
  /** Every lookup so far, oldest first. */
  lookups: Lookup[];
  /** Puts a password on the list. */
  add: (password: string) => void;
  /** Answers every lookup with this status instead, e.g. 503. */
  failWith: (status: number | undefined) => void;
  stop: () => Promise<void>;
};

/** The uppercase SHA-1 of a password, as the list stores it. */
export function sha1(password: string): string {
  return createHash("sha1").update(password).digest("hex").toUpperCase();
}

export async function startBreachList(leaked: string[]): Promise<BreachList> {
  const hashes = new Set(leaked.map(sha1));
  const lookups: Lookup[] = [];
  let failing: number | undefined;

  const server = createServer((request, response) => {
    const prefix = request.url?.match(/^\/range\/([0-9A-Fa-f]{5})$/)?.[1];
    if (!prefix) {
      response.writeHead(404).end();
      return;
    }
    const padding = request.headers["add-padding"];
    lookups.push({
      prefix: prefix.toUpperCase(),
      padding: Array.isArray(padding) ? padding[0] : padding,
    });
    if (failing) {
      response.writeHead(failing).end();
      return;
    }
    // Each line is the rest of a hash and how often it was seen. The last
    // line is padding the way the real list adds it: a count of 0.
    const lines = [...hashes]
      .filter((hash) => hash.startsWith(prefix.toUpperCase()))
      .map((hash) => `${hash.slice(5)}:7`);
    lines.push(`${"0".repeat(35)}:0`);
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(lines.join("\r\n"));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    lookups,
    add: (password) => void hashes.add(sha1(password)),
    failWith: (status) => {
      failing = status;
    },
    stop: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
