---
title: "Rate limits and lockout"
description: "The per-address limit, the per-email code limits, account lockout after wrong passwords, their defaults, and how to change them."
---

# Rate limits and lockout

Dopgate slows down guessing and email flooding in three ways: a limit per client address, limits per email on sending codes, and an account lockout after wrong passwords. Admins change every number under `limits` in settings, on the console's **Settings** page or with `PATCH /api/v1/admin/settings`.

| Setting (`limits.*`) | Default | Allowed | What it limits |
| --- | --- | --- | --- |
| `ipRequestsPerMinute` | 20 | 1 to 10000 | Requests per minute from one client address to the sign-in, sign-up, and code endpoints, counted together |
| `codeResendSeconds` | 60 | 0 to 3600 | Seconds before the same email can get another code of the same purpose. 0 turns the wait off. |
| `codesPerHour` | 5 | 1 to 100 | Codes one email can receive per hour, all purposes together |
| `codeMinutes` | 10 | 1 to 60 | Minutes a code stays valid |
| `codeMaxAttempts` | 5 | 1 to 20 | Wrong tries before a code is used up |
| `lockoutAttempts` | 5 | 1 to 100 | Wrong passwords in a row before the account locks |
| `lockoutMinutes` | 15 | 1 to 1440 | Minutes a locked account stays locked |

A limit that is hit answers `429 RATE_LIMITED` with a `Retry-After` header in seconds, and a message such as "Too many attempts. Try again in 42 seconds."

## The per-address limit

These endpoints share one budget per client address:

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/verification/send` and `/confirm`
- `POST /api/v1/auth/password/forgot` and `/reset`

The address is the connection's peer address. Behind a reverse proxy, every request would seem to come from the proxy and share one budget, so list the proxy in `DOPGATE_TRUSTED_PROXIES`. Dopgate then reads `X-Forwarded-For` from the right, skipping trusted hops. See [Configuration](/self-hosting/configuration#behind-a-reverse-proxy).

## The code limits

Every endpoint that emails a code (verification, sign-in by code, password reset, and email change) checks two limits on the receiving email before it answers: the wait between codes of the same purpose, and the hourly cap. They apply whether or not the email has an account, so the answers never reveal which emails do. An admin sending a reset code from the admin API skips these two limits.

A new code replaces the previous one of the same purpose. Each code allows `codeMaxAttempts` wrong tries; the answer says how many are left, and after the last one the code is used up.

## Account lockout

After `lockoutAttempts` wrong passwords in a row, the account locks for `lockoutMinutes`. While it is locked, every password sign-in answers `401 AUTHENTICATION_INVALID`, the same as a wrong password, so an attacker can't tell the lock from a miss. The audit log records each failed attempt as `user.sign_in_failed` with the reason `password` or `locked`.

The counter starts over after the account locks, and these clear it:

- a successful sign-in, by password or by code,
- a password reset or a password change.

A sign-in by emailed code still works while the account is locked, since it doesn't involve the password. Admins see `lockedUntil` on the user in the admin API and the console. There is no separate unlock call: the lock runs out, or the user resets their password.

## The setup token

`POST /api/v1/bootstrap/root` has its own fixed limit: 5 wrong setup tokens from one address lock that address out for 15 minutes.

## Counters live in memory

The per-address and per-email counters live in the Dopgate process and reset when it restarts. That fits the usual setup of one Dopgate container per app. If you run several replicas, each one counts separately, so the real limit is the setting times the number of replicas. The account lockout is stored on the user row in PostgreSQL and survives restarts.
