---
title: "Tokens and sessions"
description: "Access tokens, refresh token rotation and reuse detection, session lifetimes, verifying tokens in Node, Go, and Python, and the offline verification gap."
---

# Tokens and sessions

Each sign-in starts a session: one signed-in device. A session hands out two kinds of tokens.

| Token | Looks like | Lifetime (default) | Used for |
| --- | --- | --- | --- |
| Access token | An ES256 JWT, `eyJ...` | 15 minutes | Sent to your backend as `Authorization: Bearer <token>` |
| Refresh token | `dgr_` and 43 random characters | 30 days unused, single use | Traded at `POST /api/v1/auth/refresh` for new tokens |

Admins change the lifetimes in settings under `tokens`: `accessTokenMinutes` (1 to 1440), `refreshTokenIdleDays` (1 to 3650), `sessionAbsoluteDays` (1 to 3650, at least the idle limit), and `refreshReuseSeconds` (0 to 60, see [below](#a-repeated-refresh)). A session ends at the latest `sessionAbsoluteDays` (90 by default) after sign-in, however often it refreshes. `PATCH /api/v1/admin/settings` replaces the whole `tokens` section, so send all four fields.

## Access tokens

An access token is a JWT signed with ES256. Its header names the signing key in `kid`, and its claims are:

| Claim | Example | Meaning |
| --- | --- | --- |
| `iss` | `https://auth.example.com` | Dopgate's public URL, without a trailing slash |
| `aud` | `https://auth.example.com` | Who the token is for. The same URL as `iss`. |
| `sub` | `usr_01JC8Z...` | The user ID. Use it as the foreign key in your tables. |
| `sid` | `ses_01JC8Z...` | The session ID |
| `email` | `ana@example.com` | The email when the token was issued |
| `email_verified` | `true` | Whether the email was confirmed when the token was issued |
| `kind` | `human` | `human` for a person who signed in |
| `public_metadata` | `{"role": "manager"}` | The user's [`publicMetadata`](/guide/profile-and-metadata#reading-publicmetadata-from-the-token) when the token was issued. Left out when it is empty. |
| `iat`, `exp` | `1762700000` | Issued at and expiry, in Unix seconds |
| `jti` | `jti_01JC8Z...` | This token's own ID, different for every token |

A token traded from a [personal token](/guide/personal-tokens) carries `via: "pat"` and `tid`, the token's ID, in place of `sid`. An [agent's](/ai-agents/verify-in-your-backend) token has `kind: "agent"`, with `owner` and `capabilities` in place of the email claims.

Admins never get one of these tokens: the console signs them in with tokens that only Dopgate can verify. [Token claims](/reference/token-claims) has the full reference.

## Verifying a token in your backend

Fetch the key set from `{public URL}/.well-known/jwks.json`, cache it, and check:

- the signature, with the key whose `kid` matches the token header, using ES256 only,
- `iss` and `aud` both equal your `DOPGATE_PUBLIC_URL` without a trailing slash,
- `exp` is in the future.

A tool that configures itself from the issuer URL, such as an API gateway, finds the key set through `{public URL}/.well-known/openid-configuration`. See [the discovery document](/reference/token-claims#the-discovery-document).

Dopgate serves the key set with `Cache-Control: public, max-age=300`. When a token names a `kid` you haven't seen, fetch the set again: a key was rotated. The libraries below do that for you.

::: code-group

```js [Node (jose)]
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "https://auth.example.com";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export async function verify(token) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: issuer,
    algorithms: ["ES256"],
  });
  return payload; // payload.sub is the user ID
}
```

```go [Go]
package auth

import (
	"context"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

const issuer = "https://auth.example.com"

func NewVerifier(ctx context.Context) (func(string) (string, error), error) {
	jwks, err := keyfunc.NewDefaultCtx(ctx, []string{issuer + "/.well-known/jwks.json"})
	if err != nil {
		return nil, err
	}
	return func(raw string) (string, error) {
		token, err := jwt.Parse(raw, jwks.Keyfunc,
			jwt.WithValidMethods([]string{"ES256"}),
			jwt.WithIssuer(issuer),
			jwt.WithAudience(issuer),
			jwt.WithExpirationRequired(),
		)
		if err != nil {
			return "", err
		}
		return token.Claims.GetSubject() // the user ID
	}, nil
}
```

```python [Python (PyJWT)]
# pip install "pyjwt[crypto]"
import jwt

ISSUER = "https://auth.example.com"
jwks = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json")

def verify(token: str) -> dict:
    key = jwks.get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        key.key,
        algorithms=["ES256"],
        issuer=ISSUER,
        audience=ISSUER,
        options={"require": ["exp", "iat", "sub"]},
    )
    return claims  # claims["sub"] is the user ID
```

:::

## The offline verification gap

Your backend verifies tokens without asking Dopgate, which keeps requests fast and keeps your app working if Dopgate is briefly down. The cost is that a token stays valid in your backend until it expires, even after the session ends.

When a user signs out, an admin disables the account, or a password reset ends every session, Dopgate stops refreshing those sessions at once and refuses their access tokens on its own endpoints. A backend that verifies offline keeps accepting the last access token for up to the access token lifetime, 15 minutes by default. If that gap matters for an action, such as deleting data or moving money, shorten `accessTokenMinutes`, or check the user with `GET /api/v1/admin/users/{id}` before acting.

The same goes for claims. `email`, `email_verified`, and `public_metadata` are copied into the token when it is issued and only change on the next refresh.

## Refresh token rotation

A refresh token works once. Each call to `POST /api/v1/auth/refresh` returns a new access token and a new refresh token, and the old refresh token is spent:

```bash
curl -X POST https://auth.example.com/api/v1/auth/refresh \
  -H 'content-type: application/json' \
  -d '{"refreshToken":"dgr_Jq3..."}'
```

Each refresh pushes the session's idle limit forward, up to its absolute end.

If a spent refresh token comes back after the reuse window, Dopgate takes it as a sign that the token was copied. It ends the whole session, records `session.refresh_reused` in the audit log, and answers `401 TOKEN_INVALID`. The user has to sign in again on that device.

### A repeated refresh

Two tabs, two servers, or a retry after a dropped connection can send the same refresh token at nearly the same moment. Within `refreshReuseSeconds` (10 by default) of the first use, a spent token gets the same answer as the first time: the same new refresh token, with a fresh access token. If the session has refreshed again since, the answer is its newest refresh token, so every tab ends up holding the same one.

Refresh tokens are stored only as hashes. To give the same answer twice, Dopgate stores the new token encrypted with a key derived from the spent one, so only someone holding the spent token can read it, and only inside the window. For those seconds a copied token gets the same answer as the real one instead of ending the session. Set `refreshReuseSeconds` to `0` to end the session on any repeat.

A refresh token that is unknown, expired, used, or belongs to an ended session answers `401 TOKEN_INVALID`. A disabled account answers `403 ACCOUNT_DISABLED`.

## Sessions a user can see

A signed-in user lists their devices, most recently used first:

```bash
curl https://auth.example.com/api/v1/auth/sessions \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

Each session has `id`, `method` (`password` or `otp`), `ipAddress`, `userAgent`, `current` (true for the session making the request), `createdAt`, `lastUsedAt`, and `expiresAt`.

| Call | Effect |
| --- | --- |
| `DELETE /api/v1/auth/sessions/{id}` | End one session of the current account. |
| `DELETE /api/v1/auth/sessions` | End every session. Add `?keepCurrent=true` to stay signed in here. |
| `POST /api/v1/auth/logout` | End the current session, or every session with `{"allSessions": true}`. It also takes `{"refreshToken": "dgr_..."}` without an access token, so an app can sign out after the access token expired. |

Admins see and end a user's sessions with `GET` and `DELETE /api/v1/admin/users/{id}/sessions`, and end one of them with `DELETE /api/v1/admin/users/{id}/sessions/{sessionId}`.

## What ends a session

- The user signs out, ends it from the session list, or signs out everywhere.
- The user changes their password. Every other session ends.
- A password reset. Every session ends.
- An admin disables or deletes the account, or ends its sessions.
- A spent refresh token is presented again.
- The refresh token goes unused for `refreshTokenIdleDays`, or `sessionAbsoluteDays` pass.

## Signing keys

Dopgate generates a P-256 key the first time it starts and keeps it in the `signing_keys` table. Root rotates it from the console's **Signing keys** page, with `POST /api/v1/admin/keys/rotate`, or with [`dopgate keys rotate`](/cli/commands#keys-rotate). After a rotation the old key is `retiring`: it stays in the key set and verifies the tokens it signed for 24 hours, the longest an access token can live, and is then `retired` and leaves the key set. A rotation also replaces the console's own signing secret. Admins stay signed in: the console's current access tokens stop working, and the console refreshes them.
