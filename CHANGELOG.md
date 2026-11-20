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
  `kind` (`human` or `agent`) and no role.
- Access tokens carry `aud`, the same public URL as `iss`, and `jti`, an ID
  of their own. Check `aud` in your backend next to `iss`; some JWT libraries
  refuse a token with an audience unless you name the one you expect.
- `GET /.well-known/openid-configuration` returns a discovery document with
  `issuer` and `jwks_uri`, so an API gateway or a JWT library can find the
  key set from the issuer URL alone. Dopgate is still not an OpenID Connect
  provider.
- `tokens.refreshReuseSeconds`, 10 by default: a spent refresh token sent
  again within that many seconds gets the session's newest refresh token
  instead of ending the session, so two tabs or a retried request don't sign
  anyone out. `0` turns it off. The console has the field under Settings.
- Sessions: list devices and sign out one or all at `/api/v1/auth/sessions`.
- Admins are separate from your app's users. Root and admins have `adm_` IDs
  and their own sessions and codes, and sign in to the console only, at
  `/api/v1/console`. Their tokens are signed with an internal key that isn't
  in the JWKS, so no backend can accept them. The same email can belong to an
  admin and a user. Rotating keys retires the console key on every server at
  once.
- Admin API for users: search, create, update metadata, disable, delete, send
  reset codes, and sign out. Admins and `DOPGATE_SERVICE_KEY` can use it.
- `publicMetadata` travels in a person's access token as the
  `public_metadata` claim, so your backend can read a role or a plan without
  calling Dopgate. The claim is left out when the object is empty, and a
  change reaches the token on the next refresh. `publicMetadata` is limited
  to 1 KB; `userMetadata` and `privateMetadata` keep 16 KB and stay out of
  the token.
- Root manages admins at `/api/v1/admin/admins`; admins and the service key
  can read the list.
- Personal tokens (`dgp_`) let a user sign in as themselves from a script.
  Users make them at `/api/v1/auth/personal-tokens` once an admin turns on
  `selfService.personalTokens`, and trade them at `POST /api/v1/auth/token`
  for an access token with `via: "pat"`. Tokens can expire, are capped per
  user, and admins can list and revoke them without seeing them.
- Agents (`agt_`) are accounts for bots and AI agents. Each belongs to an
  admin or a user, signs in only by trading its one `dga_` token at
  `/api/v1/auth/token`, and carries flat key-value capabilities that land in
  its access token next to `kind: "agent"` and `owner`. Admins make agents in
  the console; users make their own at `/api/v1/auth/agents` once
  `selfService.agents` is on. Disabling or deleting an owner stops or
  removes their agents.
- Six email templates with built-in defaults that admins can edit, preview,
  test, and reset at `/api/v1/admin/email-templates`.
- New passwords are checked against passwords known from data breaches, the
  way NIST 800-63B asks. Dopgate sends the first five characters of the
  password's SHA-1 hash to Pwned Passwords and compares the answer itself, so
  the password never leaves your server. A listed password answers
  `422 PASSWORD_LEAKED`. A list that can't be reached never blocks a
  password. `password.rejectLeaked` turns it off, and the console has the
  switch under Settings. `DOPGATE_LEAKED_PASSWORDS_URL` points the check at a
  mirror of the list.
- Limits: per-address and per-email request limits, code resend waits, and
  account lockout after five wrong passwords, all editable in settings.
- `GET /api/v1/admin/users?email=` finds the one user with that email.
  `search` matches part of an email, so it can't tell `ana@` from `hana@`.
- A backend that signs people in for them can send the service key in
  `X-Dopgate-Backend-Key` with the visitor's address and browser in
  `X-Dopgate-Client-IP` and `X-Dopgate-Client-Agent`. Limits, the device
  list and the audit log then show the visitor instead of the backend. A
  wrong key answers `401 BACKEND_KEY_INVALID`, a code of its own, so a
  backend can tell its setup error from a visitor's wrong password.
- Error messages say what happened in plain words and name none of
  Dopgate's routes, so an app can show them to the person as they are.
- SMTP through `DOPGATE_SMTP_*`, or from the console when `DOPGATE_SMTP_HOST`
  is empty. The environment wins over the console, and with neither, emails
  go to the log. A password saved in the console is encrypted with a key
  from `DOPGATE_SERVICE_KEY`. The sender defaults to `no-reply@dopgate.com`.
- `testEmail.recipient` sets where the SMTP test and template tests go.
  Until someone saves an address, they go to root, no matter who sends them.
  The service key can send them too. The console has the field next to Send
  test email under Settings. A one-off `to` still works on the SMTP test.
- A hash-chained audit log with retention (`DOPGATE_AUDIT_RETENTION_DAYS`,
  365 days by default) and a verify endpoint.
- The admin console at `/`: users, agents, admins, email templates,
  settings, signing keys, audit log, and your account. Admins sign in to it at
  `/api/v1/console`; your app's users can't.
- The Dopgate brand: the Hash D logo, Gate Red, and the Geist wordmark across
  the console, docs, README, and favicons.
- CORS for the origins in `DOPGATE_ALLOWED_ORIGINS`.
- A `Dockerfile` and a `docker-compose.yml` with PostgreSQL 18 and Dopgate.
- Release archives of the `dopgate` binary for Linux and macOS, on amd64 and
  arm64, with a `checksums.txt` to verify them. Each GitHub release takes its
  notes from this file.
- Documentation site and README for the setup above. The docs cover personal
  tokens, agents, console tokens, and starting over from a development
  build. The home page links each feature to its guide and walks through the
  four steps from an empty database to a verified token.
- A guide for web apps with a backend: the backend signs people in through
  Dopgate and keeps both tokens in an encrypted HttpOnly cookie, so no
  long-lived token reaches the browser and Dopgate can run on any domain.
- Single sign-on and MFA routes answer `501 NOT_IMPLEMENTED` until they are
  built. They are hidden from the API docs at `/api/docs` for now.

### Security

- Wrong current passwords on password and email changes count toward the
  per-address limit and the account lockout, so a stolen access token can't
  be used to guess the password.
- An account without a password needs an emailed reset code to set one, so a
  stolen access token alone can't add a password and keep the account. The
  console's Account page asks for the code.
- A value sent to `/api/v1/auth/token` that isn't a `dgp_` or `dga_` token is
  recorded as `token.rejected` without any of its characters. Before, its
  last four were kept, which could be the end of a password pasted into the
  wrong field.
