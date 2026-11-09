# Changelog

All notable changes to Dopgate are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

The first release: an authentication server for one app, backed by PostgreSQL,
with an admin console and Docker images. Nothing below has shipped before.

### Added

- The `dopgate` binary: `serve`, `init`, `keys rotate`, and `healthcheck`.
  Settings come from `DOPGATE_*` variables, with an optional TOML file.
- PostgreSQL storage through `DOPGATE_DATABASE_URL`. Every table lives in the
  `dopgate` schema (`DOPGATE_DATABASE_SCHEMA`), so it can share your app's
  database.
- Root setup: `DOPGATE_ROOT_EMAIL` on a fresh database prints a generated
  password once; otherwise a one-time setup token, `/setup`, or `dopgate init`.
- Sign-up, sign-in by password or emailed 6-digit code, sign-out, profile
  (`displayName`, `avatarUrl`, `userMetadata`), password change, and email
  change.
- Email verification and password reset by code. Sign-in requires a verified
  email by default (`signup.requireEmailVerification`).
- ES256 access tokens with `/.well-known/jwks.json`, key rotation, and
  single-use refresh tokens that end the session when reused.
- Sessions: list devices and sign out one or all at `/api/v1/auth/sessions`.
- Admin API for users: search, create, update metadata, disable, delete, send
  reset codes, and sign out. Admins and `DOPGATE_SERVICE_KEY` can use it;
  only root manages admins.
- Six email templates with built-in defaults that admins can edit, preview,
  test, and reset at `/api/v1/admin/email-templates`.
- Limits: per-address and per-email request limits, code resend waits, and
  account lockout after five wrong passwords, all editable in settings.
- SMTP through `DOPGATE_SMTP_*`. Without a host, emails go to the log.
- A hash-chained audit log with retention (`DOPGATE_AUDIT_RETENTION_DAYS`,
  365 days by default) and a verify endpoint.
- The admin console at `/`: users, email templates, settings, signing keys,
  audit log, and your account.
- The Dopgate brand: the Hash D logo, Gate Red, and the Geist wordmark across
  the console, docs, README, and favicons.
- CORS for the origins in `DOPGATE_ALLOWED_ORIGINS`.
- A `Dockerfile` and a `docker-compose.yml` with PostgreSQL and Dopgate.
- Documentation site and README for the setup above.
- Single sign-on and MFA routes are listed in the API and answer
  `501 NOT_IMPLEMENTED` until they are built.
