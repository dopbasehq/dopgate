---
title: "Product status"
description: "Which dopgate features work today, which endpoints are placeholders, and which phase brings each one."
---

# Product status

dopgate {{version}} has its full API laid out. Every endpoint exists, is documented in Swagger, and checks the caller's credentials. Endpoints whose feature is not built yet answer `501 Not Implemented` with the error code `NOT_IMPLEMENTED`.

| Feature | Status | Phase |
| --- | --- | --- |
| Server, configuration, CLI `serve` and `init` | Works | 0 |
| Setup: root account by CLI or setup token | Works | 0 |
| Health check | Works | 0 |
| Swagger UI and OpenAPI document | Works | 0 |
| Audit log hash chain and retention | Works (written by setup; admin endpoints need sign-in) | 0 |
| Sign-up, sign-in, sign-out, profile, change password | Placeholder | 1 |
| Admin user management | Placeholder | 1 |
| Access tokens, refresh tokens, JWKS, key rotation | Placeholder | 2 |
| Session list and sign-out of a device | Placeholder | 2 |
| SMTP settings and outgoing email | Works through `server.toml` (admin endpoints need sign-in) | 3 |
| Email verification and passwordless sign-in | Placeholder | 3 |
| Forgot and reset password | Placeholder | 3 |
| Rate limits and account lockout for sign-in | Planned | 4 |
| Clients: publishable and secret keys, CORS, redirect URLs | Placeholder | 5 |
| Single sign-on with OpenID Connect providers | Placeholder (provider presets work) | 6 |
| Backup, restore, user export and import | Placeholder | 7 |
| MFA with an authenticator app | Placeholder | 8 |
| dopgate as an OpenID Connect provider | Placeholder | 9 |
| Webhooks | Planned | 10 |
| Admin UI | Planned | Later |

The [roadmap](/about/roadmap) describes each phase.

## Why sign-in-protected endpoints answer 401 first

Protected endpoints check the `Authorization` header before anything else. Without a token they answer `401 AUTHENTICATION_REQUIRED`. With one, they answer `501` until access tokens land in phase 2, because there is nothing to verify the token against yet.
