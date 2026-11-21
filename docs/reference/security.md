---
title: "Security model"
description: "How Dopgate stores passwords, tokens, codes, and keys, how it avoids revealing accounts, and the protections on its HTTP responses."
---

# Security model

This page describes what Dopgate protects and how. For the steps you take when deploying, see the [security checklist](/self-hosting/security-checklist).

## What is stored and how

| Secret | Stored as |
| --- | --- |
| Passwords | Argon2id hashes with a random salt each. Passwords are limited to 1024 bytes so hashing stays cheap enough. |
| Refresh tokens | SHA-256 hashes. The token itself is 32 random bytes and only exists in the response. |
| Personal tokens and agent tokens | SHA-256 hashes, plus the last four characters to tell them apart. Each token is 32 random bytes, shown once when it is made. |
| Emailed codes | SHA-256 hashes, single use, compared in constant time, and burned after too many wrong tries. |
| Signing keys | The P-256 private key as a PKCS#8 PEM in `signing_keys`, readable by anyone who can read the schema. |
| Service key | Not stored. It is read from the environment and compared in constant time. |
| Setup token | Kept in memory only, and gone once root exists or the server restarts. |
| SMTP password | From the environment or the config file, it isn't stored. Saved from the console, it is encrypted with ChaCha20-Poly1305 under a key derived from `DOPGATE_SERVICE_KEY`, and never returned by the API. |

The database is the boundary that matters most. Keep the `dopgate` schema readable only by Dopgate's own role, as the [PostgreSQL page](/self-hosting/postgres#give-dopgate-its-own-role) explains.

## Tokens

App access tokens are ES256 JWTs. Dopgate accepts one only with `alg: ES256` and a `kid` from the key set, checks the issuer and expiry with 30 seconds of leeway, and on its own endpoints also checks that the session is still open and the account still active. Your backend verifies offline and can't make those last two checks.

Console access tokens are HS256 JWTs signed with a secret that never leaves Dopgate and isn't in the JWKS. Dopgate accepts one only when its `kid` is the current console secret and its audience is `dopgate-console`, then runs the same issuer, expiry, session and account checks. A backend that trusts the JWKS can't verify them, so an admin's token never works against your app. See [the offline verification gap](/guide/tokens-and-sessions#the-offline-verification-gap).

Refresh tokens rotate on every use. A spent token presented again ends its session, since it means two parties hold the same token.

## Leaked passwords

Attackers try passwords from other sites' breaches first, so Dopgate refuses a new password that is on a list of them. It checks when a user signs up, resets or changes a password, and when an admin creates a user or an admin with one. It doesn't check at sign-in, and it doesn't check the root password set during setup.

The list is [Pwned Passwords](https://haveibeenpwned.com/Passwords). For each new password, Dopgate makes one request from your server:

```text
GET https://api.pwnedpasswords.com/range/21BD1
Add-Padding: true
```

`21BD1` is the first five characters of the password's SHA-1 hash. The answer holds every listed hash that starts with those five, and Dopgate compares the rest on your server. The password and the full hash never leave it, and `Add-Padding` makes every answer a similar size.

- A listed password answers `422 PASSWORD_LEAKED`.
- If the list can't be reached within 2 seconds, the password is accepted and the server logs a warning. A server without outbound internet access behaves as if the check were off, 2 seconds slower per new password.
- To turn it off, set `password.rejectLeaked` to `false` in settings, or use the switch under **Settings**, **Password** in the console.
- To ask a copy of the list on your own network instead, set `DOPGATE_LEAKED_PASSWORDS_URL` to its address. Dopgate then sends the same `GET /range/<prefix>` request there.

## Not revealing accounts

- A sign-in for an unknown email checks the password against a dummy hash, so the answer takes about as long as for a real account, and the error is the same as a wrong password.
- A disabled or unverified account is only reported after the right password.
- A locked account answers like a wrong password.
- Asking for a verification, sign-in, or reset code always answers `200`, and the per-email limits apply whether or not the email has an account.

Sign-up is the exception: it answers `409 EMAIL_TAKEN` for an email that has an account, so users learn they should sign in. Turn sign-up off if that matters for your app. Email change does the same for the new address.

## Limits

Per-address limits, per-email code limits, and account lockout slow down guessing and email flooding. See [Rate limits and lockout](/guide/rate-limits). The setup token allows 5 wrong tries per address per 15 minutes.

A backend can name the visitor's address in `X-Dopgate-Client-IP`, but only next to the service key in `X-Dopgate-Backend-Key`. Without the key the header is ignored, and CORS doesn't allow either header, so a page in a browser can't choose the address its limits are counted against.

## HTTP protections

Every response carries:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

API responses also carry `Cache-Control: no-store`. Request bodies are limited to 3 MB and requests to 30 seconds. CORS allows only the origins in `DOPGATE_ALLOWED_ORIGINS` and never allows credentials. Both refresh cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` on an HTTPS public URL. The app's `dopgate_refresh` cookie is limited to `/api/v1/auth`, and the console's `dopgate_console` cookie to `/api/v1/console`.

## Admins and users

Admins and your app's users are separate accounts in separate tables, with separate sessions and codes. Root, admins, users, and the service key have the permissions listed in [Admins and users](/guide/admins-and-users). Root can't be changed through the admin API by anyone, root included, and only root rotates keys or manages admins.

Console tokens are signed with HS256 and a 32-byte secret in `console_keys`. The secret never leaves Dopgate and isn't in the JWKS, so a backend that trusts the key set can't accept an admin's token. Rotating the signing keys replaces it too.

## Audit log

Sign-ins, failed sign-ins, account changes, and admin actions are recorded with the actor, the client address, and the time, in the same transaction as the change. Records are SHA-256 hash-chained, and the chain head is written to the server log at startup, shutdown, and each verification. See [Audit events](/reference/audit-events).

## Reporting a vulnerability

Report security problems privately to the maintainers. Please don't open a public issue for them.
