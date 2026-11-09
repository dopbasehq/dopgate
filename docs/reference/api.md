---
title: "REST API"
description: "Every Dopgate endpoint grouped by area, with the authentication it needs, its request and response fields, and its errors."
---

# REST API

Every endpoint lives under `/api/v1`, except the key set at `/.well-known/jwks.json`. Request and response bodies are JSON with camelCase fields. The running server serves the same API as Swagger UI at `/api/docs` and as OpenAPI at `/api/v1/openapi.json`.

## Conventions

### Authentication

| Label | Send |
| --- | --- |
| Public | Nothing |
| User | `Authorization: Bearer <access token>` of a signed-in user. The service key is refused with `403 AUTHORIZATION_DENIED`. |
| Admin | An access token of root or an admin, or `Authorization: Bearer <DOPGATE_SERVICE_KEY>`. Members get `403 AUTHORIZATION_DENIED`. |
| Root | An access token of the root account. |

A missing header answers `401 AUTHENTICATION_REQUIRED`. A bad header or an unknown token answers `401 AUTHENTICATION_INVALID` or `401 TOKEN_INVALID`. An access token of a disabled account answers `403 ACCOUNT_DISABLED`. These apply to every authenticated endpoint and aren't repeated below.

### Envelope

Successful answers have `success`, a `message` code, and `data`:

```json
{ "success": true, "message": "USER_FETCHED", "data": { "...": "..." } }
```

Some actions return `data: null`. Errors have `success: false` and an `error` object that maps one code to a message. See [Errors](/reference/errors).

### Pagination

List endpoints take `limit` (1 to 200, default 50) and `cursor`, and return `{ "items": [...], "nextCursor": "..." }`. Pass `nextCursor` back as `cursor` until it is `null`. An invalid cursor answers `400 REQUEST_INVALID`.

### Objects

A user, as `/auth/*` endpoints return it:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | `usr_` prefix |
| `email` | string | Lowercased |
| `emailVerified` | boolean | |
| `displayName` | string or null | |
| `avatarUrl` | string or null | |
| `role` | string | `root`, `admin`, or `member` |
| `status` | string | `active` or `disabled` |
| `userMetadata` | object | Written by the user |
| `publicMetadata` | object | Written by admins and the service key |
| `hasPassword` | boolean | False for accounts that sign in with codes only |
| `lastSignInAt` | string or null | RFC 3339 time |
| `createdAt`, `updatedAt` | string | RFC 3339 time |

An admin user is the same object plus `privateMetadata` (object) and `lockedUntil` (time, set while the account is locked).

Tokens, as every sign-in returns them:

| Field | Type | Notes |
| --- | --- | --- |
| `accessToken` | string | ES256 JWT |
| `tokenType` | string | Always `Bearer` |
| `expiresIn` | number | Seconds until the access token expires |
| `refreshToken` | string or null | `dgr_` prefix. `null` in [cookie mode](/guide/sign-in#cookie-sessions-for-the-console). |
| `user` | user | The signed-in user |

A session:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | `ses_` prefix |
| `method` | string | `password` or `otp` |
| `ipAddress`, `userAgent` | string or null | Recorded at sign-in |
| `current` | boolean | True for the session making the request. Always false in admin lists. |
| `createdAt`, `lastUsedAt`, `expiresAt` | string | `expiresAt` is the session's absolute end |

## Health

### `GET /api/v1/health`

Public. Answers `200 HEALTH_OK` while the database answers, `503 HEALTH_DEGRADED` while it doesn't.

| Response field | Value |
| --- | --- |
| `product` | `dopgate` |
| `version` | The server version, such as `{{version}}` |
| `apiVersion` | `v1` |
| `status` | `ok` or `degraded` |
| `database` | `ok` or `unavailable` |

## Setup

### `GET /api/v1/bootstrap/status`

Public. Returns `{ "initialized": true }` once the root account exists.

### `POST /api/v1/bootstrap/root`

Public. Creates root with the setup token printed at startup. Works once.

| Request field | Required | Notes |
| --- | --- | --- |
| `setupToken` | yes | The `setup_` token from the log |
| `email` | yes | |
| `password` | yes | At least 8 characters |

Answers `201 ROOT_CREATED` with `userId` and `email`. Errors: `401 SETUP_TOKEN_INVALID`, `409 ALREADY_INITIALIZED`, `422 EMAIL_INVALID`, `422 PASSWORD_INVALID`, and `429 RATE_LIMITED` after 5 wrong tokens from one address in 15 minutes.

## Auth

### `GET /api/v1/auth/methods`

Public. What your sign-in screen should offer.

| Response field | Type | Notes |
| --- | --- | --- |
| `signupEnabled` | boolean | From `signup.enabled` |
| `password` | boolean | Always `true` |
| `emailOtp` | boolean | Always `true` |
| `emailVerificationRequired` | boolean | From `signup.requireEmailVerification` |
| `branding` | object | `appName` and `logoUrl` |

### `POST /api/v1/auth/signup`

Public. Creates a member account and emails a `verify_email` code.

| Request field | Required | Notes |
| --- | --- | --- |
| `email` | yes | |
| `password` | yes | At least the minimum length, at most 1024 bytes |
| `displayName` | no | One line, up to 255 characters |

Answers `201 SIGNED_UP` with `user`, `verificationRequired`, `verificationSent`, and `tokens`, which is `null` while verification is required. Errors: `403 SIGNUP_DISABLED`, `409 EMAIL_TAKEN`, `422 EMAIL_INVALID`, `422 PASSWORD_INVALID`, `422 PROFILE_INVALID`, `429 RATE_LIMITED`.

### `POST /api/v1/auth/login`

Public. Signs in with `email` and `password`. Answers `200 SIGNED_IN` with tokens. Errors: `401 AUTHENTICATION_INVALID` (wrong email or password, or a locked account), `403 ACCOUNT_DISABLED`, `403 EMAIL_NOT_VERIFIED`, `429 RATE_LIMITED`.

Send `X-Dopgate-Session: cookie` to get the refresh token in the `dopgate_refresh` cookie instead of the body. The console does this; apps shouldn't need to.

### `POST /api/v1/auth/refresh`

Public. Trades a refresh token for new tokens.

| Request field | Required | Notes |
| --- | --- | --- |
| `refreshToken` | no | Leave it out to use the `dopgate_refresh` cookie |

Answers `200 TOKENS_REFRESHED` with tokens. The old refresh token is spent; presenting it again ends the session. Errors: `401 TOKEN_INVALID` (unknown, spent, or expired token, or an ended session), `403 ACCOUNT_DISABLED`.

### `POST /api/v1/auth/logout`

Public, or User. Ends the session of the access token, or of the refresh token when no valid access token is sent.

| Request field | Required | Notes |
| --- | --- | --- |
| `refreshToken` | no | Ends this token's session. Works after the access token expired. |
| `allSessions` | no | `true` ends every session of the account |

Answers `200 SIGNED_OUT` with `data: null`, and clears the console cookie when one was sent. An unknown refresh token still answers `200`. Errors: `401 AUTHENTICATION_REQUIRED` when neither token is sent.

### `GET /api/v1/auth/me`

User. Returns the signed-in user with `200 ACCOUNT_FETCHED`. `404 NOT_FOUND` if the account was deleted.

### `PATCH /api/v1/auth/me`

User. Updates the signed-in user's profile. Fields you leave out stay as they are.

| Request field | Notes |
| --- | --- |
| `displayName` | One line, up to 255 characters. Empty string clears it. |
| `avatarUrl` | `http(s)` URL, up to 2048 characters. Empty string clears it. |
| `userMetadata` | JSON object up to 16 KB. Replaces the whole object. |

Answers `200 PROFILE_UPDATED` with the user. Errors: `422 PROFILE_INVALID`, `422 METADATA_INVALID`.

### `POST /api/v1/auth/password/change`

User. Sets a new password and ends every other session of the account.

| Request field | Required | Notes |
| --- | --- | --- |
| `currentPassword` | when the account has a password | |
| `newPassword` | yes | |

Answers `200 PASSWORD_CHANGED` and emails `password_changed`. Errors: `401 AUTHENTICATION_INVALID` (wrong current password), `422 PASSWORD_INVALID`.

### `POST /api/v1/auth/email/change`

User. Emails an `email_change` code to the new address. Confirm it with `/auth/verification/confirm`.

| Request field | Required | Notes |
| --- | --- | --- |
| `newEmail` | yes | |
| `password` | when the account has a password | The current password |

Answers `200 EMAIL_CHANGE_CODE_SENT`. Errors: `401 AUTHENTICATION_INVALID`, `409 EMAIL_TAKEN`, `422 EMAIL_INVALID`, `429 RATE_LIMITED`.

## Codes

### `POST /api/v1/auth/verification/send`

Public. Emails a 6-digit code. Always answers `200 CODE_SENT`, whether or not the email has an account.

| Request field | Required | Notes |
| --- | --- | --- |
| `email` | yes | |
| `purpose` | yes | `email_verify` or `login` |

A code goes out for `email_verify` when the account is active and unverified, and for `login` when the account is active, or when the email is unknown and passwordless sign-up is on. Errors: `422 EMAIL_INVALID`, `422 REQUEST_INVALID` (another purpose), `429 RATE_LIMITED`.

### `POST /api/v1/auth/verification/confirm`

Public. Confirms a code.

| Request field | Required | Notes |
| --- | --- | --- |
| `email` | yes | The address the code went to. For `email_change`, the new address. |
| `purpose` | yes | `email_verify`, `login`, or `email_change` |
| `code` | yes | Spaces and dashes are ignored |

For `email_verify` and `login`: marks the email verified, starts a session, and answers `200 SIGNED_IN` with tokens. Takes `X-Dopgate-Session: cookie` like sign-in.

For `email_change`: moves the account to the new email, emails `email_changed` to the old address, and answers `200 EMAIL_CHANGED` with the user.

Errors: `400 CODE_INVALID`, `400 CODE_EXPIRED`, `403 ACCOUNT_DISABLED`, `409 EMAIL_TAKEN` (email change), `422 EMAIL_INVALID`, `422 REQUEST_INVALID` (`password_reset` purpose), `429 RATE_LIMITED`.

## Password recovery

### `POST /api/v1/auth/password/forgot`

Public. Emails a `password_reset` code to an active account with this `email`. Always answers `200 PASSWORD_RESET_SENT`. Errors: `422 EMAIL_INVALID`, `429 RATE_LIMITED`.

### `POST /api/v1/auth/password/reset`

Public. Sets a new password with the code.

| Request field | Required |
| --- | --- |
| `email` | yes |
| `code` | yes |
| `newPassword` | yes |

Answers `200 PASSWORD_RESET`. Every session ends, the lockout clears, the email counts as verified, and `password_changed` is emailed. Errors: `400 CODE_INVALID`, `400 CODE_EXPIRED`, `403 ACCOUNT_DISABLED`, `422 EMAIL_INVALID`, `422 PASSWORD_INVALID`, `429 RATE_LIMITED`.

## Sessions

### `GET /api/v1/auth/sessions`

User. The signed-in user's active sessions, most recently used first, with `200 SESSIONS_FETCHED`.

### `DELETE /api/v1/auth/sessions/{id}`

User. Ends one session of the signed-in user. Answers `200 SESSION_REVOKED`, or `404 NOT_FOUND` when the account has no open session with that ID.

### `DELETE /api/v1/auth/sessions`

User. Ends every session of the signed-in user. With `?keepCurrent=true`, the session making the request stays. Answers `200 SESSIONS_REVOKED`.

## Keys

### `GET /.well-known/jwks.json`

Public. The JSON Web Key Set: `{ "keys": [...] }` with the active key and any retiring key, which stays for 24 hours after a rotation. Not wrapped in the envelope. Cached for 5 minutes. See [Token claims](/reference/token-claims#the-key-set).

### `GET /api/v1/admin/keys`

Admin. Every signing key, with `id`, `algorithm` (`ES256`), `status` (`active`, `retiring`, or `retired`), `createdAt`, `rotatedAt`, and `retiredAt`. Answers `200 SIGNING_KEYS_FETCHED`.

### `POST /api/v1/admin/keys/rotate`

Root. Makes a new active key and moves the old one to `retiring`. Answers `200 SIGNING_KEY_ROTATED` with the new key.

## Users

All user endpoints need Admin. `{id}` is a user ID with the `usr_` prefix; an unknown ID answers `404 NOT_FOUND`. Endpoints that change an account follow the rules in [Users and roles](/guide/users-and-roles#who-can-manage-whom): `403 ROOT_PROTECTED` for root, `403 AUTHORIZATION_DENIED` when an admin or the service key acts on an admin.

### `GET /api/v1/admin/users`

Lists admin users, newest first, with `200 USERS_FETCHED`.

| Query | Notes |
| --- | --- |
| `search` | Matches the email or display name |
| `role` | `root`, `admin`, or `member` |
| `status` | `active` or `disabled` |
| `cursor`, `limit` | See [Pagination](#pagination) |

### `POST /api/v1/admin/users`

Creates an account without sending email. Answers `201 USER_CREATED` with the admin user.

| Request field | Required | Notes |
| --- | --- | --- |
| `email` | yes | |
| `password` | no | Leave out for an account that signs in with codes |
| `role` | no | `admin` or `member`, default `member`. Only root creates admins. |
| `displayName` | no | |
| `emailVerified` | no | Default `false` |
| `publicMetadata` | no | JSON object up to 16 KB |
| `privateMetadata` | no | JSON object up to 16 KB |

Errors: `403 AUTHORIZATION_DENIED`, `409 EMAIL_TAKEN`, `422 EMAIL_INVALID`, `422 PASSWORD_INVALID`, `422 PROFILE_INVALID`, `422 METADATA_INVALID`.

### `GET /api/v1/admin/users/{id}`

Returns one admin user with `200 USER_FETCHED`.

### `PATCH /api/v1/admin/users/{id}`

Updates an account. Fields you leave out stay as they are. Answers `200 USER_UPDATED`.

| Request field | Notes |
| --- | --- |
| `displayName`, `avatarUrl` | Empty string clears |
| `emailVerified` | `true` or `false` |
| `role` | `admin` or `member`. Root only. |
| `publicMetadata`, `privateMetadata` | Replace the whole object |

Errors: `403 ROOT_PROTECTED`, `403 AUTHORIZATION_DENIED`, `422 PROFILE_INVALID`, `422 METADATA_INVALID`.

### `DELETE /api/v1/admin/users/{id}`

Deletes the account, its sessions, and its codes. Answers `204` with no body.

### `POST /api/v1/admin/users/{id}/disable`

Refuses new sign-ins and ends every session. Answers `200 USER_DISABLED` with the user.

### `POST /api/v1/admin/users/{id}/enable`

Lets the account sign in again. Answers `200 USER_ENABLED` with the user.

### `POST /api/v1/admin/users/{id}/password-reset`

Emails the user a `password_reset` code. Answers `200 PASSWORD_RESET_SENT`.

### `GET /api/v1/admin/users/{id}/sessions`

The user's active sessions, with `200 SESSIONS_FETCHED`.

### `DELETE /api/v1/admin/users/{id}/sessions`

Ends every session of the user. Answers `200 SESSIONS_REVOKED`.

## Settings

### `GET /api/v1/admin/settings`

Admin. Answers `200 SETTINGS_FETCHED` with every section.

| Section | Fields and defaults |
| --- | --- |
| `signup` | `enabled` (`true`), `requireEmailVerification` (`true`), `passwordlessSignup` (`false`) |
| `password` | `minLength` (`8`, allowed 8 to 128) |
| `tokens` | `accessTokenMinutes` (`15`, 1 to 1440), `refreshTokenIdleDays` (`30`, 1 to 3650), `sessionAbsoluteDays` (`90`, 1 to 3650, not less than the idle limit) |
| `limits` | `codeMinutes` (`10`), `codeMaxAttempts` (`5`), `codeResendSeconds` (`60`), `codesPerHour` (`5`), `lockoutAttempts` (`5`), `lockoutMinutes` (`15`), `ipRequestsPerMinute` (`20`). Ranges in [Rate limits](/guide/rate-limits). |
| `branding` | `appName` (`dopgate`, one line up to 255 characters), `logoUrl` (`null`, an `http(s)` URL) |
| `smtp` | Read-only: `host`, `port`, `security`, `username`, `passwordSet`, `fromEmail`, `fromName`, `source` (`server_config` or `log`) |

### `PATCH /api/v1/admin/settings`

Admin. Send any of `signup`, `password`, `tokens`, `limits`, and `branding`. Each section you send replaces the stored one whole; fields missing from a section you send take their defaults. Answers `200 SETTINGS_UPDATED` with every section. Errors: `422 SETTINGS_INVALID` for a value out of range or any `smtp` field.

```json
{ "signup": { "enabled": true, "requireEmailVerification": true, "passwordlessSignup": true } }
```

### `POST /api/v1/admin/settings/smtp/test`

Admin. Sends a test message through the configured SMTP server. Optional `to`; the default is the caller's own email. Answers `200 SMTP_TEST_SENT`. Errors: `400 EMAIL_INVALID`, `400 SMTP_NOT_CONFIGURED`, `502 SMTP_SEND_FAILED`.

## Email templates

All need Admin. `{name}` is one of `verify_email`, `login_code`, `password_reset`, `email_change`, `email_changed`, `password_changed`; anything else answers `404 NOT_FOUND`. A template body has `subject`, `html`, and `text`, all required.

### `GET /api/v1/admin/email-templates`

Lists the six templates with `name`, `description`, `customized`, `subject`, and `updatedAt`, with `200 EMAIL_TEMPLATES_FETCHED`.

### `GET /api/v1/admin/email-templates/{name}`

Returns `name`, `description`, `customized`, the `subject`, `html`, and `text` in use, `variables`, `updatedAt`, and `defaults` (the built-in `subject`, `html`, and `text`), with `200 EMAIL_TEMPLATE_FETCHED`.

### `PUT /api/v1/admin/email-templates/{name}`

Saves an override. Answers `200 EMAIL_TEMPLATE_SAVED` with the template. Errors: `422 TEMPLATE_INVALID`.

### `DELETE /api/v1/admin/email-templates/{name}`

Removes the override. Answers `200 EMAIL_TEMPLATE_RESET` with the built-in template.

### `POST /api/v1/admin/email-templates/{name}/preview`

Renders a draft with sample values without saving or sending. Answers `200 EMAIL_TEMPLATE_PREVIEWED` with the rendered `subject`, `html`, and `text`. Errors: `422 TEMPLATE_INVALID`.

### `POST /api/v1/admin/email-templates/{name}/test`

Renders a draft with sample values and sends it to the caller's email. Answers `200 EMAIL_TEMPLATE_TEST_SENT`. Errors: `400 EMAIL_INVALID` for the service key, `422 TEMPLATE_INVALID`, `502 SMTP_SEND_FAILED`. Without SMTP the message is written to the log.

## Audit

### `GET /api/v1/admin/audit-events`

Admin. Audit records, newest first, with `200 AUDIT_EVENTS_FETCHED`. Query: `action`, `actor` (a user ID or actor label), `cursor`, `limit`. See [Audit events](/reference/audit-events).

### `GET /api/v1/admin/audit-events/verify`

Admin. Recomputes the hash chain and answers `200 AUDIT_CHAIN_VERIFIED` with `ok`, `records`, `headSeq`, `headHash`, `legacy`, `unsequenced`, `prunedSeq`, `broken`, and `anchor`. Optional query `anchorSeq` and `anchorHash`, given together; otherwise `400 REQUEST_INVALID`.

## Planned endpoints

These routes exist but answer `501 NOT_IMPLEMENTED` after their authentication check. They are left out of the Swagger UI at `/api/docs` and `/api/v1/openapi.json` until they work.

| Endpoint | Auth | Feature |
| --- | --- | --- |
| `POST /api/v1/auth/mfa/totp/enroll` | User | Start authenticator app setup |
| `POST /api/v1/auth/mfa/totp/verify` | User | Confirm the authenticator app and get recovery codes |
| `DELETE /api/v1/auth/mfa/totp` | User | Remove the authenticator app |
| `POST /api/v1/auth/mfa/challenge` | Public | Finish a sign-in with a second factor |
| `GET /api/v1/auth/sso/providers` | Public | Enabled single sign-on providers |
| `GET /api/v1/auth/sso/{provider_id}/start` | Public | Start a provider sign-in |
| `GET /api/v1/auth/sso/callback` | Public | Provider callback |
| `POST /api/v1/auth/sso/exchange` | Public | Trade a handoff code for tokens |
| `GET`, `POST /api/v1/admin/sso/providers` | Admin | List and add providers |
| `GET`, `PATCH`, `DELETE /api/v1/admin/sso/providers/{id}` | Admin | Read, change, and remove a provider |

`GET /api/v1/admin/sso/presets` (Admin) already works and returns the provider presets with `id`, `label`, `buttonLabel`, `issuer`, and `hint`. It stays out of the API docs with the rest of single sign-on.
