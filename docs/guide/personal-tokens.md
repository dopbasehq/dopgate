---
title: "Personal tokens"
description: "Let your users make tokens that sign in as themselves, for scripts and other systems, and trade them for access tokens at /api/v1/auth/token."
---

# Personal tokens

A personal token lets a script or another system act as one of your users, the way a GitHub token does. The user makes the token while signed in, gives it to the script, and the script trades it for a short-lived access token whenever it needs one.

Personal tokens are off until an admin turns them on: **Settings → Tokens and agents** in the console, or `selfService.personalTokens` in `PATCH /api/v1/admin/settings`. The same section sets how many tokens one user may have, 10 by default.

```bash
curl -X PATCH https://auth.example.com/api/v1/admin/settings \
  -H "authorization: Bearer $DOPGATE_SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"selfService":{"personalTokens":true,"maxPersonalTokensPerUser":10}}'
```

## Making a token

Your app calls `POST /api/v1/auth/personal-tokens` with the user's access token, a name, and an optional expiry. Dopgate has no screen for this, so build one in your app.

```bash
curl -X POST https://auth.example.com/api/v1/auth/personal-tokens \
  -H "authorization: Bearer $USER_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"laptop-cli","expiresAt":"2027-02-09T00:00:00Z"}'
```

```json
{
  "token": "dgp_Lm3QhT0kLw8vN3bR6yHc1uZ7pE4sA5mJdK0tVg9c01",
  "personalToken": {
    "id": "pat_01JC8Z...",
    "name": "laptop-cli",
    "lastFour": "9c01",
    "expiresAt": "2027-02-09T00:00:00Z",
    "expired": false,
    "lastUsedAt": null,
    "createdAt": "2026-11-09T09:00:00Z"
  }
}
```

The `token` is in this answer only. Dopgate stores a SHA-256 hash and the last four characters, so show the token once and tell the user to copy it. Names are 1 to 64 characters and unique per user. The expiry can be up to three years ahead; leave it out for a token that never expires.

Only a password or code sign-in can make, list, or delete personal tokens. An access token traded from a personal token gets `403` there, so a leaked token can't make more of itself.

## Signing in with a token

The script trades the token at `POST /api/v1/auth/token`:

```bash
curl -X POST https://auth.example.com/api/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"token":"dgp_Lm3Q...9c01"}'
```

```json
{ "accessToken": "eyJhbGciOiJFUzI1NiIs...", "tokenType": "Bearer", "expiresIn": 900 }
```

The access token is an ordinary ES256 user token, verified against the JWKS like any other. Its claims carry the user's `sub` and `kind: "human"`, plus `via: "pat"` and `tid`, the token's ID, in place of `sid`. There is no refresh token and no session: trade the token again when the access token expires. See [Token claims](/reference/token-claims).

| Answer | When |
| --- | --- |
| `401 TOKEN_INVALID` | The token is wrong or was deleted. Recorded in the audit log as `token.rejected`, with only the last four characters. |
| `401 TOKEN_EXPIRED` | The token is past its expiry. It stays in the user's list, marked `expired`, until they delete it. |
| `403 ACCOUNT_DISABLED` | The user is disabled. Enabling them makes the token work again. |
| `429 RATE_LIMITED` | Too many attempts from this address, as on password sign-in. |

## Listing and deleting

`GET /api/v1/auth/personal-tokens` lists the user's tokens, newest first, without the tokens themselves. `DELETE /api/v1/auth/personal-tokens/{id}` deletes one: it stops trading at once, and Dopgate refuses the access tokens it already got. A backend that verifies offline accepts those until they expire.

Deleting a user deletes their tokens. Turning `selfService.personalTokens` off stops new tokens; existing ones keep working, and users can still list and delete them.

Admins see a user's tokens on the user's page in the console, or with `GET /api/v1/admin/users/{id}/personal-tokens`, and revoke one with `DELETE /api/v1/admin/users/{id}/personal-tokens/{tokenId}`. They never see a token. The service key can list but not revoke.
