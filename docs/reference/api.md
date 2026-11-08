---
title: "REST API"
description: "Every dopgate API route with its authentication and current status."
---

# REST API

All routes return JSON. Successful responses look like this:

```json
{ "success": true, "message": "USER_FETCHED", "data": { } }
```

Errors are described on the [Errors](/reference/errors) page.

## Authentication

| Scheme | Header | Used by |
| --- | --- | --- |
| None | | Health, setup, sign-up, sign-in, and the key set |
| Publishable key | `X-Dopgate-Client: pk_...` | Apps, on sign-up and sign-in calls. Optional. |
| Bearer token | `Authorization: Bearer <access token>` | Signed-in users, and admins on the admin API |
| Secret key | `Authorization: Bearer sk_...` | Backends calling the admin API |

## Routes

Status is `works` or the phase that builds it. Everything else answers `501 NOT_IMPLEMENTED` for now.

### Public

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | None | works |
| GET | `/api/v1/bootstrap/status` | None | works |
| POST | `/api/v1/bootstrap/root` | Setup token in the body | works |
| GET | `/.well-known/jwks.json` | None | 2 |

### End users

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/methods` | None | 1 |
| POST | `/api/v1/auth/signup` | Publishable key | 1 |
| POST | `/api/v1/auth/login` | Publishable key | 1 |
| POST | `/api/v1/auth/refresh` | Refresh token in the body | 2 |
| POST | `/api/v1/auth/logout` | Bearer | 1 |
| GET, PATCH | `/api/v1/auth/me` | Bearer | 1 |
| POST | `/api/v1/auth/password/change` | Bearer | 1 |
| POST | `/api/v1/auth/password/forgot` | Publishable key | 3 |
| POST | `/api/v1/auth/password/reset` | Code or token in the body | 3 |
| POST | `/api/v1/auth/verification/send` | Publishable key | 3 |
| POST | `/api/v1/auth/verification/confirm` | Publishable key | 3 |
| GET | `/api/v1/auth/sessions` | Bearer | 2 |
| DELETE | `/api/v1/auth/sessions/{id}` | Bearer | 2 |
| POST | `/api/v1/auth/mfa/totp/enroll` | Bearer | 8 |
| POST | `/api/v1/auth/mfa/totp/verify` | Bearer | 8 |
| DELETE | `/api/v1/auth/mfa/totp` | Bearer | 8 |
| POST | `/api/v1/auth/mfa/challenge` | MFA token in the body | 8 |
| GET | `/api/v1/auth/sso/providers` | None | 6 |
| GET | `/api/v1/auth/sso/{provider_id}/start` | None | 6 |
| GET | `/api/v1/auth/sso/callback` | None (the provider calls it) | 6 |
| POST | `/api/v1/auth/sso/exchange` | Handoff code in the body | 6 |

### Admin

These need a bearer token of root or an admin, or a secret key. Rows marked root need the root account.

| Method | Path | Status |
| --- | --- | --- |
| GET, POST | `/api/v1/admin/users` | 1 |
| GET, PATCH, DELETE | `/api/v1/admin/users/{id}` | 1 |
| DELETE | `/api/v1/admin/users/{id}/sessions` | 2 |
| GET, POST | `/api/v1/admin/clients` | 5 |
| GET, PATCH, DELETE | `/api/v1/admin/clients/{id}` | 5 |
| POST | `/api/v1/admin/clients/{id}/secret` | 5 |
| GET | `/api/v1/admin/keys` | 2 |
| POST | `/api/v1/admin/keys/rotate` (root) | 2 |
| GET, PATCH | `/api/v1/admin/settings` | works once sign-in lands |
| POST | `/api/v1/admin/settings/smtp/test` | works once sign-in lands |
| GET | `/api/v1/admin/sso/presets` | works once sign-in lands |
| GET, POST | `/api/v1/admin/sso/providers` | 6 |
| GET, PATCH, DELETE | `/api/v1/admin/sso/providers/{id}` | 6 |
| GET | `/api/v1/admin/audit-events` | works once sign-in lands |
| GET | `/api/v1/admin/audit-events/verify` | works once sign-in lands |
| GET, POST | `/api/v1/admin/backups` (root) | 7 |
| GET, DELETE | `/api/v1/admin/backups/{key}` (root) | 7 |
| POST | `/api/v1/admin/backups/{key}/restore` (root) | 7 |
| GET | `/api/v1/admin/export` | 7 |
| POST | `/api/v1/admin/import` | 7 |

### dopgate as an OpenID Connect provider

| Method | Path | Status |
| --- | --- | --- |
| GET | `/.well-known/openid-configuration` | 9 |
| GET | `/oauth/authorize` | 9 |
| POST | `/oauth/token` | 9 |
| GET | `/oauth/userinfo` | 9 |
