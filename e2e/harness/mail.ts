// Reads the email a server sent. Without SMTP, Dopgate writes every message
// to its log, which is where the codes come from. With a fake SMTP server
// (harness/smtp.ts) the messages come from there instead.
import type { SmtpSink } from "./smtp.ts";

export type Mail = {
  to: string;
  subject: string;
  /** The plain-text body. */
  text: string;
  /** The message as it went over SMTP. Empty for a logged message. */
  raw: string;
};

const ANSI = /\u001b\[[0-9;]*m/g;
const LOGGED = "so the message was logged instead of sent:";

/**
 * Every message in a server log, oldest first. A logged message is the
 * text, then ` to=<email> subject=<subject>` on the line its last line
 * ends.
 */
export function mailsInLog(log: string): Mail[] {
  const mails: Mail[] = [];
  for (const chunk of log.replace(ANSI, "").split(LOGGED).slice(1)) {
    const fields = chunk.match(/ to=(\S+) subject=(.*)$/m);
    if (!fields || fields.index === undefined) continue;
    mails.push({
      to: fields[1]!,
      subject: fields[2]!.trim(),
      text: chunk.slice(0, fields.index).replace(/^\n/, ""),
      raw: "",
    });
  }
  return mails;
}

/** The 6-digit code in a message, from its own line or from the subject. */
export function codeIn(mail: Mail): string | undefined {
  return (
    mail.text.match(/^\s*(\d{6})\s*$/m)?.[1] ??
    mail.subject.match(/\b(\d{6})\b/)?.[1]
  );
}

export class Mailbox {
  private readonly log: () => Promise<string>;
  private readonly smtp: SmtpSink | undefined;

  constructor(log: () => Promise<string>, smtp?: SmtpSink) {
    this.log = log;
    this.smtp = smtp;
  }

  /** Every message sent so far, oldest first. */
  async all(): Promise<Mail[]> {
    return this.smtp ? [...this.smtp.messages] : mailsInLog(await this.log());
  }

  /** Every message sent to `email`, oldest first. */
  async to(email: string): Promise<Mail[]> {
    const address = email.toLowerCase();
    return (await this.all()).filter((mail) => mail.to === address);
  }

  /**
   * The newest message to `email`, waiting up to three seconds for it:
   * Dopgate sends mail a moment after the request that caused it. Pass
   * `after` to wait for a message beyond the ones already counted.
   */
  async last(email: string, opts: { after?: number } = {}): Promise<Mail> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const mails = await this.to(email);
      if (mails.length > (opts.after ?? 0)) return mails[mails.length - 1]!;
      await new Promise((wait) => setTimeout(wait, 100));
    }
    throw new Error(`No email was sent to ${email}`);
  }

  /** How many messages `email` has received. */
  async count(email: string): Promise<number> {
    return (await this.to(email)).length;
  }

  /** The code in the newest message to `email`. */
  async code(email: string, opts: { after?: number } = {}): Promise<string> {
    const mail = await this.last(email, opts);
    const code = codeIn(mail);
    if (!code)
      throw new Error(
        `The newest email to ${email} has no code: "${mail.subject}"`,
      );
    return code;
  }
}
