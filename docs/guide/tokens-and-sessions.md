---
title: "Tokens and sessions"
description: "How dopgate access tokens and refresh tokens work, and how your backend verifies a token."
---

# Tokens and sessions

::: warning Planned
Tokens and sessions arrive in phase 2. This page describes how they will work, so you can plan your integration.
:::

A successful sign-in returns two tokens:

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiIsImtpZCI6ImtleV8uLi4ifQ...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshToken": "dgr_...",
  "user": { "id": "usr_...", "email": "person@example.com", "role": "member" }
}
```

## Access tokens

The access token is a JWT signed with ES256. It lives 15 minutes. Send it to your backend as `Authorization: Bearer <token>`.

Its claims:

| Claim | Meaning |
| --- | --- |
| `iss` | The public URL of your dopgate server. |
| `sub` | The user ID. |
| `aud` | The client ID, when the app sent a publishable key. |
| `exp`, `iat` | Expiry and issue time, in seconds since the epoch. |
| `sid` | The session ID. |
| `email`, `email_verified` | The account's email and whether it is verified. |
| `role` | `root`, `admin`, or `member`. |

### Verifying a token in your backend

1. Fetch `https://<your dopgate>/.well-known/jwks.json` and cache it.
2. Read the `kid` from the token header and pick the matching key. If none matches, fetch the key set again; dopgate may have rotated its key.
3. Check the signature, then `iss`, `exp`, and `aud` if you use clients.

Most JWT libraries do all of this given the JWKS URL. In Node.js with `jose`:

```js
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://auth.example.com/.well-known/jwks.json"));

const { payload } = await jwtVerify(token, jwks, {
  issuer: "https://auth.example.com",
});
// payload.sub is the user ID
```

## Refresh tokens

The refresh token starts with `dgr_`. Send it to `POST /api/v1/auth/refresh` before the access token expires to get a new pair. Each refresh token works once. If a used one comes back, dopgate assumes it was copied and ends the whole session.

Keep refresh tokens out of places scripts can read. In a browser, an HTTP-only cookie set by your own backend is the safer home.

## Sessions

Every sign-in creates a session: one device, one browser. A session ends when it is unused for 30 days, 90 days after sign-in at most, or when someone ends it. Users list theirs at `GET /api/v1/auth/sessions` and end one with `DELETE /api/v1/auth/sessions/{id}`. Admins can end every session of a user.

Ending a session stops its refresh token at once. Its last access token keeps working until it expires, at most 15 minutes later. If that gap matters for an action, check the session with dopgate before doing it.

## Key rotation

`dopgate keys rotate` or `POST /api/v1/admin/keys/rotate` makes a new signing key. The old key stays in the key set until the last token it signed expires, so backends that cache the key set keep working.
