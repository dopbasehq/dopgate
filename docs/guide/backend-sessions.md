---
title: "Sign-in through your backend"
description: "Keep Dopgate's tokens on your server in an encrypted HttpOnly cookie, so no long-lived token reaches the browser and Dopgate can live on any domain."
---

# Sign-in through your backend

A web app with its own backend doesn't need the browser to talk to Dopgate at all. The pages post the sign-in form to your backend. Your backend calls Dopgate, keeps both tokens in an encrypted cookie that page scripts can't read, and sends the page only the user. Every later request carries that cookie, and your backend checks the access token itself.

This is the setup to pick for a web app with a server:

- No refresh token sits in browser storage, where any injected script could copy it.
- Dopgate can run on any domain, such as `auth.example.com` or a hosted address on another site entirely. Only servers talk to it, so there are no CORS or third-party cookie rules to fight.
- Your backend sees every sign-in and sign-out, and can add its own rules around them.

What you give up: sign-in passes through one more server, and an app with no backend can't do it. Mobile apps and scripts keep calling Dopgate directly, as in [Add Dopgate to your app](/guide/add-to-your-app).

The examples are Node with [jose](https://github.com/panva/jose) and the built-in `crypto` module, written against an Express-style `req` and `res`. The same steps work in any language.

## What your backend needs

| Setting | Where | Value |
| --- | --- | --- |
| `DOPGATE_SERVICE_KEY` | Dopgate | A random value of at least 32 characters, for example from `openssl rand -base64 32` |
| The same service key | Your backend | Sent in `X-Dopgate-Backend-Key` on every call |
| Dopgate's address | Your backend | Where your server reaches Dopgate. A private address is fine. |
| Dopgate's public URL | Your backend | `DOPGATE_PUBLIC_URL`, the issuer in every access token |
| A session secret | Your backend | A random value of at least 32 bytes that encrypts the cookie |

You don't need `DOPGATE_ALLOWED_ORIGINS`: the browser never calls Dopgate.

## One function for every call

Each call to Dopgate carries the service key and the visitor's address and browser. Without them, all your users share the per-address limit of one machine, and their device lists show your server. See [Passing on the visitor](/guide/admin-api#passing-on-the-visitor).

```js
const DOPGATE = process.env.DOPGATE_URL; // e.g. http://dopgate:8850
const SERVICE_KEY = process.env.DOPGATE_SERVICE_KEY;

export async function dopgate(method, path, { body, visitor, accessToken } = {}) {
  const res = await fetch(`${DOPGATE}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-dopgate-backend-key": SERVICE_KEY,
      ...(visitor?.ip && { "x-dopgate-client-ip": visitor.ip }),
      ...(visitor?.agent && { "x-dopgate-client-agent": visitor.agent }),
      ...(accessToken && { authorization: `Bearer ${accessToken}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) {
    const [code, message] = Object.entries(json.error)[0];
    // Your service key is wrong. That is your setup, not the visitor's
    // password: log it and answer 503, never pass it on.
    if (code === "BACKEND_KEY_INVALID") {
      console.error("Dopgate refused the service key:", message);
      throw Object.assign(new Error("Sign-in is unavailable."), { status: 503 });
    }
    throw Object.assign(new Error(message), { code, status: res.status });
  }
  return json.data;
}

/** The visitor as your server sees them. Make sure req.ip trusts only your own proxies. */
export function visitorOf(req) {
  return { ip: req.ip, agent: req.get("user-agent") };
}
```

## The cookie

The cookie holds both tokens, encrypted and authenticated with AES-256-GCM. Changing one byte makes it unreadable, and nobody without the session secret can read or forge it.

```js
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = createHash("sha256").update(process.env.SESSION_SECRET).digest();

export function seal(tokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function open(value) {
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(body.toString());
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000, // the refresh token's idle limit
};
```

The cookie is about 800 bytes. There is no session table: the cookie is the session. Changing `SESSION_SECRET` signs everyone out, which is also how you respond if it leaks.

## Sign in

```js
app.post("/api/sign-in", async (req, res) => {
  const tokens = await dopgate("POST", "/auth/login", {
    body: { email: req.body.email, password: req.body.password },
    visitor: visitorOf(req),
  });
  res.cookie("session", seal({ access: tokens.accessToken, refresh: tokens.refreshToken }), cookieOptions);
  res.json({ user: tokens.user }); // never the tokens
});
```

Sign-up, code confirmation (`/auth/verification/confirm`) and sign-in by code work the same way: forward the form, and when the answer carries tokens, seal them into the cookie. Password reset (`/auth/password/forgot` and `/reset`) only needs forwarding. Pass Dopgate's error code and message back to the page, so it can show "The email or password is wrong" or ask for the emailed code.

## Every request after that

Open the cookie and check the access token offline against Dopgate's public keys. Normal requests don't call Dopgate. When the 15-minute access token has run out, trade the refresh token for new ones and set the cookie again.

```js
import { createRemoteJWKSet, errors, jwtVerify } from "jose";

const issuer = process.env.DOPGATE_PUBLIC_URL;
const jwks = createRemoteJWKSet(new URL(`${DOPGATE}/.well-known/jwks.json`));
const check = (token) => jwtVerify(token, jwks, { issuer, algorithms: ["ES256"] });

export async function signedIn(req, res) {
  const tokens = open(req.cookies.session ?? "");
  if (!tokens) return null;
  try {
    return { claims: (await check(tokens.access)).payload, tokens };
  } catch (error) {
    if (!(error instanceof errors.JWTExpired)) return null;
  }
  try {
    const next = await dopgate("POST", "/auth/refresh", {
      body: { refreshToken: tokens.refresh },
      visitor: visitorOf(req),
    });
    const fresh = { access: next.accessToken, refresh: next.refreshToken };
    res.cookie("session", seal(fresh), cookieOptions);
    return { claims: (await check(fresh.access)).payload, tokens: fresh };
  } catch (error) {
    if (error.status === 401 || error.status === 403) res.clearCookie("session", cookieOptions);
    throw error;
  }
}
```

`claims.sub` is the user ID to store in your own tables. Check `claims.kind === "human"` too: agent and personal-token access tokens pass the same signature check. [Token claims](/reference/token-claims) lists the rest.

Two requests that arrive together with an expired token both refresh with the same refresh token. Dopgate answers a repeat within `tokens.refreshReuseSeconds` (10 by default) with the same new token, so both responses set the same cookie. Sharing one refresh per session inside your process still saves a call. See [A repeated refresh](/guide/tokens-and-sessions#a-repeated-refresh).

A 503 or a network error from Dopgate during a refresh isn't a signed-out user. Keep the cookie and answer 503, so the next request tries again.

## Forged requests

The browser sends the cookie on its own, so a page on another site could make a signed-in visitor's browser post to your API. `SameSite=Lax` stops most of that. Also require a header that a plain form can't send on every write: give the page a random CSRF token when it signs in, keep the same value in the sealed cookie, and refuse a `POST`, `PUT`, `PATCH` or `DELETE` whose header doesn't match it.

## Account pages

Forward the signed-in user's own actions with their access token from the cookie:

| Your route | Dopgate call |
| --- | --- |
| Profile | `GET` and `PATCH /auth/me` |
| Change password | `POST /auth/password/change`. An account without a password sends a code from `/auth/password/forgot` instead of the current one. |
| Change email | `POST /auth/email/change`, then `/auth/verification/confirm` with purpose `email_change` |
| Devices | `GET /auth/sessions`, `DELETE /auth/sessions/{id}` |
| Sign out | `POST /auth/logout` with the refresh token, then clear the cookie |

These calls reach Dopgate, so they notice at once when an admin disabled the account or a password reset ended the session. Plain requests check the access token offline and notice within 15 minutes, when the token expires and the refresh is refused. For actions that move money or change permissions, call `GET /auth/me` first to close that gap.

## Looking people up

To find an account by email, for example to add someone to a team, call the admin API with the service key as the bearer token. Use `email`, which matches one whole address. `search` matches part of one, so it would also return `hana@example.com` for `ana@example.com`.

```js
const page = await fetch(`${DOPGATE}/api/v1/admin/users?email=${encodeURIComponent(email)}`, {
  headers: { authorization: `Bearer ${SERVICE_KEY}` },
}).then((res) => res.json());
const user = page.data.items[0] ?? null;
```

The service key can do everything an admin can, so it stays on your server. See [Calling the admin API](/guide/admin-api).
