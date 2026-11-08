# Changelog

All notable changes to dopgate are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- The dopgate backend, restructured from the Dopbase secrets manager into an
  authentication server. One `dopgate` binary runs the server and its CLI and
  stores everything in one SQLite file under `~/.dopgate` (or `--data-dir`).
  The default port is 8850 and every setting reads `DOPGATE_*` variables.
- `dopgate init` creates the root account. `dopgate serve` runs the server and,
  while no root account exists, prints a one-time setup token for
  `POST /api/v1/bootstrap/root`. Five wrong tokens from one address lock it
  out for 15 minutes. `GET /api/v1/bootstrap/status` reports whether setup is
  done.
- A fresh baseline schema: users with the root, admin, and member roles;
  clients; sessions and single-use refresh tokens; emailed verification codes
  and links; JWT signing keys; runtime settings; single sign-on providers,
  identities, and flows; and the hash-chained audit log.
- Placeholder modules for every planned feature: sign-up and sign-in,
  verification and passwordless sign-in, password recovery, sessions, MFA,
  admin user management, clients, signing keys and JWKS, settings, single
  sign-on, backups with user export and import, and dopgate as an OpenID
  Connect provider. Each route exists, checks credentials, appears in Swagger
  at `/api/docs`, and answers `501 NOT_IMPLEMENTED` until its phase lands.
- Argon2id password hashing with a minimum length of 8 characters. Setup
  records an `instance.initialized` audit event.
- Planned CLI commands (`backup`, `users`, `keys`) that exit with code 2.
- Backend tests under `app/tests/`, mirroring `src/`. They cover setup and
  its lockout, every route in the OpenAPI document (401 without a token, 501
  for placeholders), the error and header layer, configuration precedence,
  the CLI binary, master-key encryption and rekeying, audit chain tampering,
  anchors and retention, rate limiting, client address resolution, roles,
  migrations up and down, and password hashing.
- OpenAPI operation IDs carry their tag (`users_list`, `clients_list`), so
  every ID in the document is unique.
- The `Authorization` header accepts the `Bearer` scheme in any case, as
  RFC 9110 requires.
- Argon2 and BLAKE2 build at full speed in release builds, which are otherwise
  optimized for size. Password hashing is about 25% faster as a result.
- SMTP settings and the mailer. `GET` and `PATCH /api/v1/admin/settings`
  store sign-up rules, the password policy, token lifetimes, SMTP, and
  branding in the `settings` table. The SMTP password is encrypted with the
  master key and only reported as `passwordSet`. Left-out fields keep their
  value, and an empty string clears one. `POST
  /api/v1/admin/settings/smtp/test` sends a message and answers `502
  SMTP_SEND_FAILED` with the server's reply when it fails. With no host set,
  mail goes to the server log. Changes are audited as `settings.updated`.
  New error codes: `SETTINGS_INVALID`, `SMTP_NOT_CONFIGURED`, and
  `SMTP_SEND_FAILED`. The admin routes still answer 501 until access tokens
  land, and the saved password policy and token lifetimes take effect when
  sign-up and tokens do.
- An `[smtp]` table in `server.toml` and matching `DOPGATE_SMTP_*`
  variables for the host, port, security, login, and sender. The mailer
  uses it while the runtime settings have no SMTP host, so SMTP works before
  the admin API does. Bad values stop the server at startup.
  `GET /api/v1/admin/settings` reports where mail goes in `smtp.source`:
  `settings`, `server_config`, or `log`. The generated `server.toml`
  documents every field.
- `lettre` for SMTP, using rustls with the system's trusted roots, like the
  OpenID Connect client.
- `rust-version = "1.89"` in `app/Cargo.toml`.
- The documentation site in `docs/`, built with VitePress: guide, CLI,
  self-hosting, reference, and roadmap.
- Root `package.json` scripts. `bun run dev` starts the API and the docs
  together; `build`, `test:app`, `lint:app`, and `format:app` wrap the Rust
  tooling.

### Removed

- Everything specific to the secrets manager: projects, environments,
  secrets, runner and personal tokens, grants, groups, custom roles, CLI
  device login, background daemon mode, and their 32 migrations.
