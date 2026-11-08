---
title: "Roadmap"
description: "The order in which dopgate features are being built."
---

# Roadmap

dopgate is built in phases. Each phase replaces placeholders with working endpoints, adds tests, and updates [Product status](/guide/product-status).

| Phase | Scope |
| --- | --- |
| 0 | Project structure, configuration, CLI, setup, migrations, audit chain, and the full API description. Done. |
| 1 | Users and the auth core: password sign-up and sign-in, sign-out, profile, change password, admin user management, roles. |
| 2 | Tokens: ES256 JWTs, the JWKS endpoint, key rotation, refresh token rotation with reuse detection, session list and revoke. |
| 3 | Email: SMTP settings, the mailer, verification by code or link, passwordless sign-in, forgot and reset password. |
| 4 | Abuse protection: per-address and per-email limits on sign-up, reset, and codes; account lockout; audit events for every auth action. |
| 5 | Clients: publishable and secret keys, CORS per client, redirect URL allow-lists. |
| 6 | Single sign-on: OpenID Connect providers with presets, account linking. |
| 7 | Backup, restore, user export, and user import, including hash formats from other services. |
| 8 | MFA with an authenticator app, with recovery codes. |
| 9 | dopgate as an OpenID Connect provider: discovery, authorize with PKCE, token, userinfo. |
| 10 | Webhooks for events such as `user.created` and `user.signed_in`. Optional. |

An Admin UI will follow once the API is complete.
