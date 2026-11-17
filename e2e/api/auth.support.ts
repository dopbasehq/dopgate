// Helpers for the app user's own auth API specs (api/auth-*.spec.ts).
import {
  expect,
  PASSWORD,
  type App,
  type ApiClient,
  type ApiResult,
  type Tokens,
} from "../harness/index.ts";
import { claims } from "../harness/helpers.ts";
import { query } from "../harness/server.ts";

/** A second password that passes every default rule. */
export const NEW_PASSWORD = "another long passphrase";

/** The audit events of one action, newest first, optionally of one actor. */
export async function auditEvents(
  app: App,
  action: string,
  actor?: string,
): Promise<Record<string, any>[]> {
  const filter = actor ? `&actor=${encodeURIComponent(actor)}` : "";
  const events = await app.service.get(
    `/admin/audit-events?action=${encodeURIComponent(action)}${filter}&limit=50`,
    { record: false },
  );
  expect(events.status, JSON.stringify(events.body)).toBe(200);
  return events.data.items;
}

/**
 * Runs `body` with one settings section changed and puts the section back
 * afterwards, so the next test in the file starts from the defaults.
 */
export async function withSettings<T>(
  app: App,
  section: string,
  change: Record<string, unknown>,
  body: () => Promise<T>,
): Promise<T> {
  const current = await app.service.must("GET", "/admin/settings", undefined, {
    record: false,
  });
  const before = current[section] as Record<string, unknown>;
  await app.settings(section, change);
  try {
    return await body();
  } finally {
    await app.settings(section, before);
  }
}

/** The session ID inside an access token. */
export function sessionOf(accessToken: string): string {
  return claims(accessToken).sid as string;
}

/** Signs up with the harness password and answers the whole result. */
export function signUp(
  api: ApiClient,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<ApiResult> {
  return api.post("/auth/signup", { email, password: PASSWORD, ...extra });
}

/** Signs a user in with the harness password on a client of its own. */
export async function signedIn(
  app: App,
  email: string,
  label = "device",
): Promise<{ api: ApiClient; tokens: Tokens }> {
  return app.userSession(email, PASSWORD, label);
}

/** Makes the newest code for an email and purpose look `seconds` old. */
export async function ageCode(
  app: App,
  email: string,
  purpose: string,
  seconds: number,
): Promise<void> {
  const rows = await query(
    app.server.schema,
    `UPDATE verification_tokens
        SET expires_at = expires_at - make_interval(secs => $3::int),
            created_at = created_at - make_interval(secs => $3::int)
      WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
      RETURNING id`,
    [email, purpose, seconds],
  );
  expect(rows.length, `a live ${purpose} code for ${email}`).toBeGreaterThan(0);
}

/** What the server stored for the codes of an email. */
export async function codeRows(
  app: App,
  email: string,
  purpose: string,
): Promise<Record<string, any>[]> {
  return query(
    app.server.schema,
    `SELECT attempts, consumed_at, expires_at FROM verification_tokens
      WHERE email = $1 AND purpose = $2 ORDER BY created_at`,
    [email, purpose],
  );
}

/** A code that is not `code`, for a wrong guess. */
export function wrongCode(code: string): string {
  return code === "000000" ? "111111" : "000000";
}
