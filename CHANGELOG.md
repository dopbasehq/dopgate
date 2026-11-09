# Changelog

All notable changes to dopgate are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

The first release: an authentication server for one app, backed by
PostgreSQL. Nothing below has shipped before.

### Added

- The `dopgate` binary: `serve`, `init`, `keys rotate`, and `healthcheck`.
  Settings come from `DOPGATE_*` variables, with an optional TOML file.
- PostgreSQL storage through `DOPGATE_DATABASE_URL`. Every table lives in the
  `dopgate` schema (`DOPGATE_DATABASE_SCHEMA`), so it can share your app's
  database.
- Root setup: `DOPGATE_ROOT_EMAIL` on a fresh database prints a generated
  password once; otherwise a one-time setup token or `dopgate init`.
- Sign-up, sign-in by password or emailed 6-digit code, sign-out, profile
  (`displayName`, `avatarUrl`, `userMetadata`), password change, and email
  change.
- Email verification and password reset by code. Sign-in requires a verified
  email by default (`signup.requireEmailVerification`).
- ES256 access tokens with `/.well-known/jwks.json`, key rotation, and
  single-use refresh tokens that end the session when reused.
- Sessions: list devices and sign out one or all at `/api/v1/auth/sessions`.
- Six email templates with built-in defaults that admins can edit, preview,
  test, and reset at `/api/v1/admin/email-templates`.
- Code limits: a wait before the same email gets another code, and a cap per
  hour, both editable in settings.
- SMTP through `DOPGATE_SMTP_*`. Without a host, emails go to the log.
- A hash-chained audit log with retention (`DOPGATE_AUDIT_RETENTION_DAYS`,
  365 days by default) and a verify endpoint.
- CORS for the origins in `DOPGATE_ALLOWED_ORIGINS`.
- Routes still being built (admin users, single sign-on, and MFA) are listed
  in the API and answer `501 NOT_IMPLEMENTED`.
