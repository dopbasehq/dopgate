---
title: "Roadmap"
description: "What Dopgate has built so far and what comes next: single sign-on, multi-factor authentication, and webhooks."
---

# Roadmap

Dopgate is built in phases. Each phase replaces placeholder endpoints with working ones, adds tests, and updates [Product status](/guide/product-status).

## Done

| Phase | Scope |
| --- | --- |
| Foundation | Project layout, configuration, the CLI, first-run setup, the hash-chained audit log, and the full API description. |
| PostgreSQL | Every table in its own schema, migrations at startup, and the switch from SQLite. |
| Accounts and tokens | Password sign-up and sign-in, sign-out, profiles and metadata, roles, ES256 access tokens, the JWKS, key rotation, refresh token rotation with reuse detection, and sessions. |
| Email codes | SMTP from the environment, six editable templates, 6-digit codes for verification, sign-in, password reset, and email change, and passwordless sign-up. |
| Admin API and limits | User management, settings, the service key, per-address and per-email limits, and account lockout. |
| Admin console | The Vue console built into the binary, for root and admins. |
| Docker and docs | The image, the Compose file, and these docs. |

## Next

| Feature | Scope |
| --- | --- |
| Single sign-on | Sign in with Google, Microsoft, Okta, or any OpenID Connect provider, with presets and account linking. The routes exist and answer `501`. |
| Multi-factor authentication | A second factor with an authenticator app (TOTP), with recovery codes. The routes exist and answer `501`. |
| Webhooks | Tell your backend about events such as `user.signed_up` and `user.deleted`. |
| Hosted pages | Maybe: ready-made sign-in and sign-up pages for apps that don't want to build their own forms. |

The order can change as people use Dopgate and report what they need.
