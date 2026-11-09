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
| Emailed codes | SHA-256 hashes, single use, compared in constant time, and burned after too many wrong tries. |
| Signing keys | The P-256 private key as a PKCS#8 PEM in `signing_keys`, readable by anyone who can read the schema. |
| Service key | Not stored. It is read from the environment and compared in constant time. |
| Setup token | Kept in memory only, and gone once root exists or the server restarts. |
| SMTP password | Not stored in the database. It comes from the environment or the config file. |

The database is the boundary that matters most. Keep the `dopgate` schema readable only by Dopgate's own role, as the [PostgreSQL page](/self-hosting/postgres#give-dopgate-its-own-role) explains.

## Tokens

Access tokens are ES256 JWTs. Dopgate only accepts `alg: ES256` with a known `kid`, checks the issuer and expiry with 30 seconds of leeway, and on its own endpoints also checks that the session is still open and the account still active. Your backend verifies offline and can't make those last two checks. See [the offline verification gap](/guide/tokens-and-sessions#the-offline-verification-gap).

Refresh tokens rotate on every use. A spent token presented again ends its session, since it means two parties hold the same token.

## Not revealing accounts

- A sign-in for an unknown email checks the password against a dummy hash, so the answer takes about as long as for a real account, and the error is the same as a wrong password.
- A disabled or unverified account is only reported after the right password.
- A locked account answers like a wrong password.
- Asking for a verification, sign-in, or reset code always answers `200`, and the per-email limits apply whether or not the email has an account.

Sign-up is the exception: it answers `409 EMAIL_TAKEN` for an email that has an account, so users learn they should sign in. Turn sign-up off if that matters for your app. Email change does the same for the new address.

## Limits

Per-address limits, per-email code limits, and account lockout slow down guessing and email flooding. See [Rate limits and lockout](/guide/rate-limits). The setup token allows 5 wrong tries per address per 15 minutes.

## HTTP protections

Every response carries:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

API responses also carry `Cache-Control: no-store`. Request bodies are limited to 3 MB and requests to 30 seconds. CORS allows only the origins in `DOPGATE_ALLOWED_ORIGINS` and never allows credentials. The console's refresh cookie is `HttpOnly`, `SameSite=Strict`, limited to `/api/v1/auth`, and `Secure` on an HTTPS public URL.

## Roles

Root, admins, members, and the service key have the permissions listed in [Users and roles](/guide/users-and-roles). Root can't be changed through the admin API by anyone, root included, and only root rotates keys or manages admins.

## Audit log

Sign-ins, failed sign-ins, account changes, and admin actions are recorded with the actor, the client address, and the time, in the same transaction as the change. Records are SHA-256 hash-chained, and the chain head is written to the server log at startup, shutdown, and each verification. See [Audit events](/reference/audit-events).

## Reporting a vulnerability

Report security problems privately to the maintainers. Please don't open a public issue for them.
