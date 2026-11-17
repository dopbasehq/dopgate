// Helpers for the console, account, admins and access matrix specs. Setup
// calls here pass `record: false` so they never stand in for a real test.
import {
  expect,
  PASSWORD,
  ROOT_EMAIL,
  type ApiClient,
  type ApiResult,
  type App,
} from "../harness/index.ts";

export { PASSWORD, ROOT_EMAIL };

/** Another password, for accounts that must not share the harness password. */
export const OTHER_PASSWORD = "another horse battery";

/** What a wrong password, an unknown email and a user's login all answer. */
export const WRONG_CREDENTIALS = {
  status: 401,
  code: "AUTHENTICATION_INVALID",
};

export type AdminRecord = {
  id: string;
  email: string;
  role: string;
  status: string;
  hasPassword: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  lockedUntil: string | null;
};

/** Asserts the status and the first error code of a failed call. */
export function expectError(
  result: ApiResult,
  status: number,
  code: string,
): void {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(result.code, JSON.stringify(result.body)).toBe(code);
}

/** Root adds an admin. Setup: not counted. */
export async function addAdmin(
  app: App,
  opts: {
    name?: string;
    email?: string;
    password?: string | false;
    displayName?: string;
  } = {},
): Promise<{ id: string; email: string; password: string | undefined }> {
  const root = await app.root();
  const email = opts.email ?? app.email(opts.name ?? "adm");
  const password = opts.password === false ? undefined : (opts.password ?? PASSWORD);
  const created = await root.api.must(
    "POST",
    "/admin/admins",
    { email, password, displayName: opts.displayName },
    { record: false },
  );
  return { id: created.id, email, password };
}

/** The audit events of one action, newest first. Not counted. */
export async function audit(
  app: App,
  action: string,
  limit = 50,
): Promise<any[]> {
  const root = await app.root();
  const found = await root.api.must(
    "GET",
    `/admin/audit-events?action=${encodeURIComponent(action)}&limit=${limit}`,
    undefined,
    { record: false },
  );
  return found.items;
}

/**
 * Waits for an audit event of `action` that `match` accepts, and returns
 * it. Failed sign-ins are written a moment after the answer.
 */
export async function auditEvent(
  app: App,
  action: string,
  match: (event: any) => boolean,
): Promise<any> {
  let found: any;
  await expect
    .poll(
      async () => {
        found = (await audit(app, action)).find(match);
        return Boolean(found);
      },
      { message: `an audit event ${action}` },
    )
    .toBe(true);
  return found;
}

/** The value of one cookie from a list of Set-Cookie headers. */
export function setCookie(
  setCookies: string[],
  name: string,
): string | undefined {
  return setCookies.find((cookie) => cookie.startsWith(`${name}=`));
}

/** `dopgate_console=dgr_…; HttpOnly; …` → the value. */
export function cookieValue(header: string): string {
  return header.split(";")[0]!.split("=").slice(1).join("=");
}

/** Signs an admin in by password on a client of its own. Not counted. */
export async function signedIn(
  app: App,
  email: string,
  password: string = PASSWORD,
): Promise<{ api: ApiClient; accessToken: string; refreshToken: string }> {
  const session = await app.consoleSession(email, password);
  return {
    api: session.api,
    accessToken: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken!,
  };
}

/** Sends a console sign-in code and returns it, off the mail log. */
export async function emailedLoginCode(
  app: App,
  email: string,
): Promise<string> {
  const before = await app.mail.count(email);
  const api = await app.anonymousApi();
  const sent = await api.post(
    "/console/codes/send",
    { email },
    { record: false },
  );
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  return app.mail.code(email, { after: before });
}

/** Five wrong passwords in a row, enough to lock an account by default. */
export async function lockOut(app: App, email: string): Promise<void> {
  const api = await app.anonymousApi();
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await api.post(
      "/console/login",
      { email, password: "not the right password" },
      { record: false },
    );
    expect(result.status).toBe(401);
  }
}
