---
title: "Token claims"
description: "The header and claims of a Dopgate access token, and the checks your backend should run."
---

# Token claims

A Dopgate access token is a JWT signed with ES256 (ECDSA on P-256 with SHA-256). Only your app's users get these tokens. Admins sign in to the console and get tokens that only Dopgate can verify; see [Admins and users](/guide/admins-and-users).

## Header

```json
{ "alg": "ES256", "typ": "JWT", "kid": "key_01JC8Z3V7Q..." }
```

`kid` names the signing key. Find the key with the same `kid` in `/.well-known/jwks.json`.

## Claims

```json
{
  "iss": "https://auth.example.com",
  "sub": "usr_01JC8Z3V7QK2N4R6T8W0Y2A4C6",
  "exp": 1762700900,
  "iat": 1762700000,
  "sid": "ses_01JC8Z3V7QK2N4R6T8W0Y2A4C7",
  "kind": "human",
  "email": "ana@example.com",
  "email_verified": true
}
```

| Claim | Type | Meaning |
| --- | --- | --- |
| `iss` | string | Dopgate's `DOPGATE_PUBLIC_URL` without a trailing slash |
| `sub` | string | The user ID, `usr_` followed by a ULID, or an agent's `agt_` ID. It never changes for the life of the account. |
| `exp` | number | Expiry, in Unix seconds. `iat` plus `accessTokenMinutes` (15 by default). |
| `iat` | number | When the token was issued, in Unix seconds |
| `sid` | string | The session ID, `ses_` followed by a ULID. It matches the `id` in the session list. Absent on a token from a personal token. |
| `kind` | string | `human` for a person who signed in, `agent` for an [agent](/guide/agents). Check it first. |
| `via` | string | `pat` when the token came from a [personal token](/guide/personal-tokens). Absent after a password or code sign-in. |
| `tid` | string | The personal token's ID, `pat_` followed by a ULID, when `via` is `pat` |
| `owner` | string | An agent's owner, an admin (`adm_`) or a user (`usr_`). Agents only. |
| `capabilities` | object | An agent's flat key-value capabilities. Agents only. |
| `email` | string | The account's email, lowercased, when the token was issued. People only. |
| `email_verified` | boolean | Whether the email was confirmed when the token was issued. People only. |

There is no `aud`, `nbf`, or `jti` claim. Profile fields and metadata are not in the token; read them from `GET /api/v1/auth/me` or the admin API.

## Checks to run

| Check | How |
| --- | --- |
| Signature | ES256 only, with the JWKS key whose `kid` matches. Refuse any other `alg`. |
| Issuer | `iss` equals your public URL without a trailing slash. |
| Expiry | `exp` is in the future. A few seconds of leeway for clock skew is fine. |
| Subject | `sub` is present. Use it as the user ID. |

Inside Dopgate, a token also has to belong to a session that hasn't ended (or a personal token that still exists and hasn't expired) and an account that isn't disabled, and the email and verified flag are read fresh from the database. Your backend can't make those checks offline. See [the offline verification gap](/guide/tokens-and-sessions#the-offline-verification-gap).

## The key set

`GET /.well-known/jwks.json` returns the public keys of the active key and any retiring key:

```json
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
      "kid": "key_01JC8Z3V7Q...",
      "alg": "ES256",
      "use": "sig"
    }
  ]
}
```

It is served with `Cache-Control: public, max-age=300`. A rotated-out key stays in the set for 24 hours, the longest an access token can live.
