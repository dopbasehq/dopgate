---
title: "Add Dopgate to your app"
description: "Call sign-up, sign-in, verification, and refresh from your frontend, then verify the JWT in your backend with the JWKS and use sub as the user ID."
---

# Add Dopgate to your app

An app that uses Dopgate has two halves. The frontend talks to Dopgate to sign users up and in and keeps their tokens. The backend receives the access token with each request, verifies it, and uses the `sub` claim as the user ID. This page walks through both with plain `fetch` calls and one backend example.

The examples use `https://auth.example.com` as Dopgate's public URL. Use your own `DOPGATE_PUBLIC_URL`.

## Allow your frontend's origin

A browser app on another origin can only call Dopgate if its origin is listed in `DOPGATE_ALLOWED_ORIGINS`:

```bash
DOPGATE_ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
```

Each entry is a scheme, a host, and an optional port, with no path. Dopgate allows `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`, the `Authorization` and `Content-Type` request headers, and exposes `Retry-After` and `X-Request-Id`. It never allows credentials across origins, so your app sends the access token in the `Authorization` header and keeps the refresh token itself. Mobile apps and servers don't need an entry, because CORS only applies to browsers.

## Every response has the same envelope

Successful calls answer with `success`, a `message` code, and `data`:

```json
{ "success": true, "message": "SIGNED_IN", "data": { "accessToken": "eyJ...", "...": "..." } }
```

Errors answer with `success: false` and an `error` object that maps one code to a message you can show the user:

```json
{ "success": false, "error": { "AUTHENTICATION_INVALID": "The email or password is wrong." } }
```

[Errors](/reference/errors) lists every code.

## Frontend: ask what to show

`GET /api/v1/auth/methods` tells your sign-in screen what is turned on:

```js
const res = await fetch("https://auth.example.com/api/v1/auth/methods");
const { data } = await res.json();
// data.signupEnabled, data.password, data.emailOtp,
// data.emailVerificationRequired, data.branding.appName
```

## Frontend: sign up and verify

```js
const auth = "https://auth.example.com/api/v1";

async function call(path, body, accessToken) {
  const res = await fetch(auth + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken && { authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!json.success) throw Object.assign(new Error(Object.values(json.error)[0]), { code: Object.keys(json.error)[0] });
  return json.data;
}

const signup = await call("/auth/signup", {
  email: "ana@example.com",
  password: "correct-horse-battery",
  displayName: "Ana",
});
```

Dopgate emails a 6-digit code. With the default settings, `signup.tokens` is `null` and `signup.verificationRequired` is `true`: show a code field, then confirm it:

```js
const tokens = await call("/auth/verification/confirm", {
  email: "ana@example.com",
  purpose: "email_verify",
  code: "482913",
});
```

When an admin has turned off **Require a verified email before signing in**, `signup.tokens` already holds the tokens and the code only marks the email verified later. [Sign-up and email verification](/guide/sign-up-and-verification) covers both cases and resending a code.

## Frontend: sign in

```js
const tokens = await call("/auth/login", {
  email: "ana@example.com",
  password: "correct-horse-battery",
});
```

Users can also sign in with an emailed code instead of a password. See [Sign-in with a password or a code](/guide/sign-in).

## Frontend: keep the tokens

Every sign-in returns the same shape:

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshToken": "dgr_Jq3...",
  "user": { "id": "usr_01JC8...", "email": "ana@example.com", "emailVerified": true, "...": "..." }
}
```

Keep the access token in memory and send it to your backend as `Authorization: Bearer <accessToken>`. Store the refresh token where your platform keeps secrets, such as the Keychain or Keystore on mobile. A refresh token works once. Trade it for new tokens before the access token runs out, or when your backend answers 401:

```js
const next = await call("/auth/refresh", { refreshToken: tokens.refreshToken });
// Replace both tokens. The old refresh token is now used up.
```

If two parts of your app refresh with the same token at once, the second call looks like a stolen token and ends the session. Refresh from one place, such as a single shared promise. [Tokens and sessions](/guide/tokens-and-sessions) explains rotation and reuse.

To sign out, send the refresh token, the access token, or both:

```js
await call("/auth/logout", { refreshToken: tokens.refreshToken }, tokens.accessToken);
```

Add `"allSessions": true` to sign out of every device.

## Backend: verify the token

Your backend verifies the access token offline. Fetch the key set from `/.well-known/jwks.json`, cache it, and check the signature (ES256), the issuer (your public URL), and the expiry. In Node with [jose](https://github.com/panva/jose):

```js
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "https://auth.example.com";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export async function currentUserId(authorizationHeader) {
  const token = authorizationHeader?.replace(/^Bearer /i, "");
  if (!token) return null;
  const { payload } = await jwtVerify(token, jwks, { issuer, algorithms: ["ES256"] });
  return payload.sub; // "usr_01JC8...", the key for your own tables
}
```

Store `sub` as the foreign key in your own tables. It never changes, even when the user changes their email. The token also carries `email`, `email_verified`, `kind`, and `sid`. [Token claims](/reference/token-claims) describes each one, and [Tokens and sessions](/guide/tokens-and-sessions) has the same check in Go and Python.

## Backend: call the admin API

When your backend needs to change an account, for example to record a plan in `publicMetadata`, it calls the admin API with `DOPGATE_SERVICE_KEY`. See [Calling the admin API](/guide/admin-api).
