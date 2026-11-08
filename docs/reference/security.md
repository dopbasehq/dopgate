---
title: "Security model"
description: "How dopgate stores passwords, tokens, and secrets, and what it does against guessing and tampering."
---

# Security model

::: info
Some of what this page describes arrives with later phases, marked where it applies. [Product status](/guide/product-status) says what runs today.
:::

## What is stored, and how

| Value | Stored as |
| --- | --- |
| Passwords | Argon2id hashes in PHC format. Passwords over 1024 bytes are refused before hashing. |
| Refresh tokens | SHA-256 hashes. A token is single-use; reuse ends the session. |
| Emailed codes and link tokens | SHA-256 hashes, single-use, valid 10 minutes. |
| Client secret keys | SHA-256 hashes, plus the last four characters for display. |
| The setup token | Memory only, gone once root exists. |
| JWT signing keys | Encrypted with the master key. |
| SSO client secrets, the SMTP password | Encrypted with the master key. |

A stolen database therefore gives no passwords and no usable tokens. A stolen database together with `master.key` also gives the signing keys, which would let the holder mint access tokens; keep the two apart.

## Tokens

Access tokens are ES256 JWTs that live 15 minutes. (Phase 2.) They cannot be recalled once issued, which is why they are short. Sessions, refresh tokens, and signing keys can all be revoked, and revoking them takes effect at the next refresh.

## Guessing

- Five wrong setup tokens from one address lock that address out for 15 minutes.
- Five wrong codes burn a verification code. (Phase 3.)
- Failed passwords lock the account for a while. (Phase 4.)
- Sign-up, password reset, and verification emails are limited per address and per email. (Phase 4.)

The limits key on the client address. Behind a reverse proxy, set `trusted_proxies` or every request looks like it comes from the proxy.

## Not telling who has an account

Password reset and verification answer the same way whether or not the email has an account. Sign-in answers "wrong email or password" without saying which. (Phases 1 and 3.)

## The audit log

Every record stores a hash of its contents and of the record before it. Changing or deleting a record breaks the chain, and `GET /api/v1/admin/audit-events/verify` finds the break. Someone with write access to the database could rebuild the whole chain, so dopgate also writes the chain head to the server log at startup and shutdown, and the verify endpoint accepts an anchor you saved elsewhere.

## HTTP

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a strict `Content-Security-Policy`. API responses also carry `Cache-Control: no-store`. Request bodies are capped at 3 MiB and requests time out after 30 seconds.
