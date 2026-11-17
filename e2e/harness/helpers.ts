// Small helpers every suite can use. Look here before you write a new one.
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { COOKIE_MODE } from "./api.ts";
import { PASSWORD, type Admin, type App } from "./index.ts";

/** A fresh directory under the file's server folder. */
export async function tempDir(app: App, prefix: string): Promise<string> {
  const base = join(app.server.root, "work");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, `${prefix}-`));
}

/** The claims of a JWT, without checking its signature. */
export function claims(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
}

/** The header of a JWT: `alg`, `kid`, `typ`. */
export function jwtHeader(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
}

/**
 * Checks an access token's ES256 signature against a key set, the way an
 * app's backend would with `/.well-known/jwks.json`.
 */
export async function verifiedByJwks(
  token: string,
  jwks: { keys: JsonWebKey[] },
): Promise<boolean> {
  const [head, body, signature] = token.split(".");
  const kid = jwtHeader(token).kid;
  const jwk = jwks.keys.find((key) => (key as { kid?: string }).kid === kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(signature!, "base64url"),
    Buffer.from(`${head}.${body}`),
  );
}

/** Types a 6-digit code into the code boxes. The last digit submits. */
export async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByTestId("code-box-0").click();
  await page.keyboard.type(code);
}

/** Fills the console's sign-in form and submits it. */
export async function signInOnPage(
  page: Page,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  const form = page.getByTestId("sign-in-form");
  await form.getByLabel("Email").fill(email);
  // Exact, or the "Show password" button next to the field matches too.
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Opens `path` in the console as `admin`, without going through the sign-in
 * page: the browser signs in with a request of its own, which leaves the
 * console's refresh cookie in it. Use it when signing in is not what the
 * test is about.
 */
export async function openAs(
  page: Page,
  admin: Pick<Admin, "email" | "password">,
  path: string,
): Promise<void> {
  const signedIn = await page.request.post("/api/v1/console/login", {
    headers: COOKIE_MODE,
    data: { email: admin.email, password: admin.password ?? PASSWORD },
  });
  expect(signedIn.status(), `${admin.email} signs in`).toBe(200);
  await page.goto(path);
}

/** The sidebar link to a page, e.g. `nav(page, "Signing keys")`. */
export function nav(page: Page, label: string) {
  return page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: label, exact: true });
}

/** Signs out from the account menu in the sidebar. */
export async function signOutOnPage(page: Page): Promise<void> {
  await page.getByTestId("account-menu-button").click();
  await page.getByTestId("sign-out-button").click();
  await expect(page).toHaveURL(/\/sign-in$/);
}
