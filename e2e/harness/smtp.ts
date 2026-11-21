// A plain-text SMTP server on a local port that keeps what it receives,
// modelled on app/tests/support/smtp.rs. Tests point Dopgate at it to check
// that mail really leaves over SMTP.
import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type { Mail } from "./mail.ts";

export type SmtpSink = {
  port: number;
  /** Every message received so far, oldest first. */
  messages: Mail[];
  /** The AUTH lines clients sent, to check a username was used. */
  auth: string[];
  /** Answers every recipient with this line instead of accepting it. */
  refuseRecipients: (reply: string | undefined) => void;
  stop: () => Promise<void>;
};

/** Undoes quoted-printable, which mail libraries use for long or odd lines. */
function decodeQuotedPrintable(text: string): string {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined[i] === "=" ? joined.slice(i + 1, i + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i]!, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function header(raw: string, name: string): string {
  const match = raw.match(
    new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im"),
  );
  return (match?.[1] ?? "").replace(/\r?\n[ \t]+/g, " ").trim();
}

/** `=?utf-8?b?…?=` and `=?utf-8?q?…?=` words in a header, decoded. */
function decodeWords(value: string): string {
  return value.replace(
    /=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi,
    (_, kind: string, data: string) =>
      kind.toLowerCase() === "b"
        ? Buffer.from(data, "base64").toString("utf8")
        : decodeQuotedPrintable(data.replace(/_/g, " ")),
  );
}

function parse(to: string, raw: string): Mail {
  // The first text/plain part, or the whole body of a single-part message.
  const parts = raw.split(/\r?\n--[^\r\n]+/);
  const plain =
    parts.find((part) => /content-type:\s*text\/plain/i.test(part)) ?? raw;
  const body = plain.slice(plain.search(/\r?\n\r?\n/)).replace(/^\s+/, "");
  const encoded = /content-transfer-encoding:\s*quoted-printable/i.test(plain);
  return {
    to,
    subject: decodeWords(header(raw, "Subject")),
    text: (encoded ? decodeQuotedPrintable(body) : body).replace(/\r\n/g, "\n"),
    raw,
  };
}

export async function startSmtp(): Promise<SmtpSink> {
  const messages: Mail[] = [];
  const auth: string[] = [];
  const sockets = new Set<Socket>();
  let refusal: string | undefined;

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    let recipients: string[] = [];
    let data: string[] | undefined;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fake ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            const raw = data.join("\r\n");
            for (const to of recipients) messages.push(parse(to, raw));
            data = undefined;
            recipients = [];
            reply("250 2.0.0 queued");
          } else {
            // A leading dot is doubled on the wire.
            data.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO")) {
          socket.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (command.startsWith("AUTH")) {
          auth.push(line);
          reply("235 2.7.0 OK");
        } else if (command.startsWith("RCPT")) {
          if (refusal) reply(refusal);
          else {
            recipients.push(line.match(/<([^>]+)>/)?.[1] ?? "");
            reply("250 2.1.5 OK");
          }
        } else if (command.startsWith("DATA")) {
          data = [];
          reply("354 go ahead");
        } else if (command.startsWith("QUIT")) {
          reply("221 bye");
          socket.end();
        } else {
          reply("250 OK");
        }
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    messages,
    auth,
    refuseRecipients: (reply) => {
      refusal = reply;
    },
    stop: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}
