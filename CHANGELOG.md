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
  single-use refresh tokens that end the session when reused. Tokens carry
  `kind` (`human`) and no role.
- Sessions: list devices and sign out one or all at `/api/v1/auth/sessions`.
- Admins are separate from your app's users. Root and admins have `adm_` IDs
  and their own sessions and codes, and sign in to the console only, at
  `/api/v1/console`. Their tokens are signed with an internal key that isn't
  in the JWKS, so no backend can accept them. The same email can belong to an
  admin and a user. Instances from before the split move root and admins
  across on upgrade, passwords included.
- Admin API for users: search, create, update metadata, disable, delete, send
  reset codes, and sign out. Admins and `DOPGATE_SERVICE_KEY` can use it.
- Root manages admins at `/api/v1/admin/admins`; admins and the service key
  can read the list.
- Personal tokens (`dgp_`) let a user sign in as themselves from a script.
  Users make them at `/api/v1/auth/personal-tokens` once an admin turns on
  `selfService.personalTokens`, and trade them at `POST /api/v1/auth/token`
  for an access token with `via: "pat"`. Tokens can expire, are capped per
  user, and admins can list and revoke them without seeing them.
- Six email templates with built-in defaults that admins can edit, preview,
  test, and reset at `/api/v1/admin/email-templates`.
- Limits: per-address and per-email request limits, code resend waits, and
  account lockout after five wrong passwords, all editable in settings.
- SMTP through `DOPGATE_SMTP_*`, or from the console when `DOPGATE_SMTP_HOST`
  is empty. The environment wins over the console, and with neither, emails
  go to the log. A password saved in the console is encrypted with a key
  from `DOPGATE_SERVICE_KEY`. The sender defaults to `no-reply@dopgate.com`.
- A hash-chained audit log with retention (`DOPGATE_AUDIT_RETENTION_DAYS`,
  365 days by default) and a verify endpoint.
- The admin console at `/`: users, admins, email templates, settings,
  signing keys, audit log, and your account. Admins sign in to it at
  `/api/v1/console`; your app's users can't.
- The Dopgate brand: the Hash D logo, Gate Red, and the Geist wordmark across
  the console, docs, README, and favicons.
- CORS for the origins in `DOPGATE_ALLOWED_ORIGINS`.
- A `Dockerfile` and a `docker-compose.yml` with PostgreSQL and Dopgate.
- Documentation site and README for the setup above.
- Single sign-on and MFA routes answer `501 NOT_IMPLEMENTED` until they are
  built. They are hidden from the API docs at `/api/docs` for now.
