---
title: "Product status"
description: "What works in Dopgate today and what is planned, by feature and by endpoint group."
---

# Product status

This page lists what works in Dopgate {{version}}. Planned endpoints already exist in the API description so client code can be written against them, and they answer `501 NOT_IMPLEMENTED` until the feature lands. Endpoints that need a signed-in user or an admin check that first, so you may see `401` or `403` before `501`.

## Works now

| Feature | Endpoints |
| --- | --- |
| Health check | `GET /api/v1/health` |
| First-run setup | `GET /api/v1/bootstrap/status`, `POST /api/v1/bootstrap/root`, `DOPGATE_ROOT_EMAIL`, `dopgate init` |
| Sign-up and sign-in with a password | `/api/v1/auth/methods`, `/signup`, `/login`, `/logout`, `/refresh` |
| Email codes: verification, sign-in, passwordless sign-up | `/api/v1/auth/verification/send`, `/confirm` |
| Password reset and change | `/api/v1/auth/password/forgot`, `/reset`, `/change` |
| Profile, metadata, and email change | `/api/v1/auth/me`, `/api/v1/auth/email/change` |
| Sessions | `/api/v1/auth/sessions`, `/api/v1/auth/sessions/{id}` |
| ES256 access tokens and the key set | `/.well-known/jwks.json`, `/api/v1/admin/keys`, `/api/v1/admin/keys/rotate`, `dopgate keys rotate` |
| Console sign-in for admins | `/api/v1/console` and everything under it |
| User management | `/api/v1/admin/users` and everything under it |
| Admin management | `/api/v1/admin/admins` and everything under it |
| Settings | `/api/v1/admin/settings`, `/api/v1/admin/settings/smtp/test` |
| Email templates | `/api/v1/admin/email-templates` and everything under it |
| Audit log with hash chain and retention | `/api/v1/admin/audit-events`, `/api/v1/admin/audit-events/verify` |
| Rate limits and account lockout | Built into the endpoints above |
| Service key for your backend | `DOPGATE_SERVICE_KEY` |
| Admin console | `/` |
| API description | `/api/docs`, `/api/v1/openapi.json` |
| Docker image and Compose file | `Dockerfile`, `docker-compose.yml`, `dopgate healthcheck` |

## Planned

| Feature | Status |
| --- | --- |
| Single sign-on with OpenID Connect providers | `GET /api/v1/admin/sso/presets` returns the preset catalog. Every other route under `/api/v1/auth/sso` and `/api/v1/admin/sso/providers` answers `501`. |
| Multi-factor authentication with an authenticator app | Every route under `/api/v1/auth/mfa` answers `501`. |
| Webhooks | Not in the API yet. |

The [roadmap](/about/roadmap) has the order these come in.

## Not planned

These were in early previews of 0.1.0 and are gone: SQLite storage and the data directory, the master key, registered clients with publishable and secret keys, built-in backup, export, and import commands, Dopgate acting as an OpenID Connect provider, and email links. Use PostgreSQL's own tools for [backups](/self-hosting/backups), the service key for your backend, and 6-digit codes for every email flow.
